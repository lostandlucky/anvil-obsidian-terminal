mod protocol;

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use clap::Parser;
use futures_util::{SinkExt, StreamExt};
use portable_pty::{CommandBuilder, ExitStatus, PtySize, native_pty_system};
use tokio::net::TcpListener;
use tokio::sync::{Mutex, mpsc};
use tokio::task;
use tokio_tungstenite::tungstenite::Message;

use protocol::{ClientMessage, ServerMessage};

#[derive(Parser, Debug)]
#[command(name = "pty-server", about = "PTY-over-WebSocket server (Phase 2a spike)")]
struct Args {
    /// Path to the shell binary to spawn (e.g. /bin/zsh).
    #[arg(long)]
    shell: PathBuf,

    /// Argument to pass to the shell. Repeat for multiple args (e.g. --shell-arg=-l).
    #[arg(long = "shell-arg", allow_hyphen_values = true)]
    shell_args: Vec<String>,

    /// Working directory the shell starts in.
    #[arg(long)]
    cwd: PathBuf,

    /// Initial PTY columns.
    #[arg(long, default_value_t = 80)]
    cols: u16,

    /// Initial PTY rows.
    #[arg(long, default_value_t = 24)]
    rows: u16,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_max_level(tracing::Level::INFO)
        .init();

    let args = Args::parse();

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .context("bind 127.0.0.1:0")?;
    let port = listener.local_addr()?.port();

    println!("PTY_SERVER_LISTENING port={port}");
    use std::io::Write;
    std::io::stdout().flush().ok();
    tracing::info!(port, "pty-server listening");

    let shutdown = Arc::new(Shutdown::new());
    let shutdown_signal = shutdown.clone();
    tokio::spawn(async move {
        let mut sigint = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())
            .expect("install SIGINT handler");
        let mut sigterm =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("install SIGTERM handler");
        tokio::select! {
            _ = sigint.recv() => tracing::info!("SIGINT received"),
            _ = sigterm.recv() => tracing::info!("SIGTERM received"),
        }
        shutdown_signal.trigger();
    });

    loop {
        if shutdown.is_set() {
            tracing::info!("shutdown set before accept, exiting");
            return Ok(());
        }
        tokio::select! {
            _ = shutdown.wait() => {
                tracing::info!("shutdown requested, exiting accept loop");
                return Ok(());
            }
            accept = listener.accept() => {
                let (stream, peer) = accept.context("accept")?;
                tracing::info!(?peer, "client connected");
                let args = args.clone();
                let shutdown = shutdown.clone();
                if let Err(e) = handle_client(stream, args, shutdown).await {
                    tracing::error!(error = ?e, "client session ended with error");
                }
                tracing::info!("client session ended");
            }
        }
    }
}

/// Sticky shutdown signal: setting it persists, and `wait()` resolves
/// immediately if already set. Built on AtomicBool + Notify so both the
/// outer accept loop and any in-flight session loop observe shutdown
/// regardless of ordering.
struct Shutdown {
    flag: AtomicBool,
    notify: tokio::sync::Notify,
}

impl Shutdown {
    fn new() -> Self {
        Self {
            flag: AtomicBool::new(false),
            notify: tokio::sync::Notify::new(),
        }
    }

    fn trigger(&self) {
        self.flag.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    fn is_set(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }

    async fn wait(&self) {
        if self.is_set() {
            return;
        }
        let notified = self.notify.notified();
        if self.is_set() {
            return;
        }
        notified.await;
    }
}

impl Clone for Args {
    fn clone(&self) -> Self {
        Args {
            shell: self.shell.clone(),
            shell_args: self.shell_args.clone(),
            cwd: self.cwd.clone(),
            cols: self.cols,
            rows: self.rows,
        }
    }
}

async fn handle_client(
    stream: tokio::net::TcpStream,
    args: Args,
    shutdown: Arc<Shutdown>,
) -> Result<()> {
    let ws = tokio_tungstenite::accept_async(stream)
        .await
        .context("websocket handshake")?;
    let (mut ws_sink, mut ws_stream) = ws.split();

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: args.rows,
            cols: args.cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| anyhow!("openpty: {e}"))?;

    let mut cmd = CommandBuilder::new(&args.shell);
    for a in &args.shell_args {
        cmd.arg(a);
    }
    cmd.cwd(&args.cwd);
    if let Ok(term) = std::env::var("TERM") {
        cmd.env("TERM", term);
    } else {
        cmd.env("TERM", "xterm-256color");
    }

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| anyhow!("spawn shell: {e}"))?;
    let child_killer = Arc::new(Mutex::new(child.clone_killer()));
    drop(pair.slave);

    let master = Arc::new(Mutex::new(pair.master));
    let mut reader = {
        let m = master.lock().await;
        m.try_clone_reader()
            .map_err(|e| anyhow!("clone reader: {e}"))?
    };
    let writer = {
        let m = master.lock().await;
        m.take_writer().map_err(|e| anyhow!("take writer: {e}"))?
    };
    let writer = Arc::new(Mutex::new(writer));

    let (out_tx, mut out_rx) = mpsc::channel::<Vec<u8>>(64);
    let reader_handle = task::spawn_blocking(move || {
        use std::io::Read;
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if out_tx.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    tracing::debug!(error = ?e, "pty reader error");
                    break;
                }
            }
        }
    });

    let exit_status: Arc<Mutex<Option<ExitStatus>>> = Arc::new(Mutex::new(None));
    let exit_status_waiter = exit_status.clone();
    let wait_handle = task::spawn_blocking(move || match child.wait() {
        Ok(status) => Some(status),
        Err(e) => {
            tracing::debug!(error = ?e, "child wait error");
            None
        }
    });

    let mut wait_handle = wait_handle;

    let session_result: Result<()> = loop {
        tokio::select! {
            biased;
            _ = shutdown.wait() => {
                tracing::info!("shutdown notified during session");
                break Ok(());
            }
            status = &mut wait_handle => {
                if let Ok(Some(s)) = status {
                    *exit_status_waiter.lock().await = Some(s);
                }
                tracing::info!("child process exited");
                break Ok(());
            }
            chunk = out_rx.recv() => {
                match chunk {
                    Some(bytes) => {
                        let msg = ServerMessage::Output(bytes).to_json();
                        if ws_sink.send(Message::Text(msg.into())).await.is_err() {
                            break Ok(());
                        }
                    }
                    None => {
                        // pty reader closed; wait for child to also exit
                    }
                }
            }
            incoming = ws_stream.next() => {
                let Some(msg) = incoming else { break Ok(()); };
                let msg = msg.context("ws receive")?;
                match msg {
                    Message::Text(text) => {
                        match ClientMessage::parse(&text) {
                            Ok(ClientMessage::Input(bytes)) => {
                                let writer = writer.clone();
                                let res = task::spawn_blocking(move || {
                                    use std::io::Write;
                                    let mut w = writer.blocking_lock();
                                    w.write_all(&bytes).and_then(|_| w.flush())
                                })
                                .await;
                                if let Err(e) = res {
                                    tracing::error!(error = ?e, "writer task panicked");
                                    break Err(anyhow!("writer task failed"));
                                }
                            }
                            Ok(ClientMessage::Resize { cols, rows }) => {
                                let m = master.lock().await;
                                if let Err(e) = m.resize(PtySize {
                                    rows,
                                    cols,
                                    pixel_width: 0,
                                    pixel_height: 0,
                                }) {
                                    tracing::warn!(error = ?e, "pty resize failed");
                                }
                            }
                            Err(e) => {
                                tracing::warn!(error = ?e, "rejecting malformed client message");
                            }
                        }
                    }
                    Message::Binary(_) => {
                        tracing::warn!("ignoring unexpected binary frame");
                    }
                    Message::Close(_) => {
                        tracing::info!("ws close received");
                        break Ok(());
                    }
                    _ => {}
                }
            }
        }
    };

    // Tear down the child no matter how we got here.
    {
        let mut killer = child_killer.lock().await;
        let _ = killer.kill();
    }

    // Give the wait task up to 1s to observe the exit, then move on.
    let _ = tokio::time::timeout(Duration::from_secs(1), async {
        let _ = reader_handle.await;
    })
    .await;

    let exit_msg = {
        let status = exit_status.lock().await.take();
        match status {
            Some(s) if s.success() => ServerMessage::Exit { status: Some(0), signal: None },
            Some(s) => ServerMessage::Exit {
                status: Some(s.exit_code() as i32),
                signal: None,
            },
            None => ServerMessage::Exit { status: None, signal: None },
        }
    };
    let _ = ws_sink.send(Message::Text(exit_msg.to_json().into())).await;
    let _ = ws_sink.send(Message::Close(None)).await;
    let _ = ws_sink.close().await;

    session_result
}
