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
        .with_writer(|| BestEffortStderr)
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

    spawn_parent_death_watchdog(shutdown.clone());

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

/// Stderr writer that swallows write errors instead of surfacing them.
///
/// When the parent (Obsidian) dies, our piped stderr breaks. On a write
/// error, tracing-subscriber's fallback is `eprintln!` — and `eprintln!`
/// **panics** when stderr is gone, killing whatever thread was mid-shutdown
/// (the parent-death watchdog before it can trigger, or the session loop
/// before it kills the shell child). Logging is best-effort; process
/// teardown is not. Verified empirically during BUG-004: the kqueue event
/// fired, but the log line before `shutdown.trigger()` panicked the thread.
struct BestEffortStderr;

impl std::io::Write for BestEffortStderr {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        match std::io::stderr().write(buf) {
            Ok(n) => Ok(n),
            // Pretend success: never let a log line kill a shutdown path.
            Err(_) => Ok(buf.len()),
        }
    }

    fn flush(&mut self) -> std::io::Result<()> {
        let _ = std::io::stderr().flush();
        Ok(())
    }
}

/// Parent-death watchdog (BUG-004): when the parent process (Obsidian) dies
/// without ever sending SIGTERM — force-quit, crash, OOM — nothing else tells
/// this binary to exit, and it would sit in the accept loop forever. Watch
/// the parent PID with kqueue `EVFILT_PROC | NOTE_EXIT` and fire the sticky
/// `Shutdown` seam when it exits; the accept loop and the session loop's
/// biased shutdown arm (which also reaps the shell child) already handle the
/// rest.
///
/// Deliberate properties:
/// - Runs on a detached plain OS thread, NOT a tokio task: a thread blocked
///   in `kevent()` cannot hold the tokio runtime alive or delay any existing
///   shutdown path, and process exit reaps it.
/// - Reacts ONLY to the parent-exit kernel event (plus install-time PPID
///   re-checks for the registration race). No polling loop, no idle timers —
///   a live-but-quiet session must never be reaped (user-named requirement).
/// - On ambiguous failure the watchdog goes inactive rather than guessing:
///   orphan risk is acceptable, killing a real session is not.
fn spawn_parent_death_watchdog(shutdown: Arc<Shutdown>) {
    // SAFETY: getppid() takes no arguments, touches no memory, and cannot fail.
    let ppid = unsafe { libc::getppid() };
    if ppid <= 1 {
        // Reparented to launchd already — the parent died before we got here.
        // Trigger BEFORE logging: with the parent dead our stderr pipe may
        // already be broken, and shutdown must not depend on a log line.
        shutdown.trigger();
        tracing::info!("parent already dead at startup (ppid={ppid}); triggering shutdown");
        return;
    }

    let spawned = std::thread::Builder::new()
        .name("parent-death-watchdog".into())
        .spawn(move || {
            // SAFETY: kqueue() allocates a new fd owned by this thread.
            let kq = unsafe { libc::kqueue() };
            if kq < 0 {
                let err = std::io::Error::last_os_error();
                tracing::warn!(error = ?err, "kqueue() failed; parent-death watchdog inactive");
                return;
            }

            // SAFETY: zeroed kevent is a valid initial value for the struct;
            // all fields are set explicitly below.
            let mut change: libc::kevent = unsafe { std::mem::zeroed() };
            change.ident = ppid as usize;
            change.filter = libc::EVFILT_PROC;
            change.flags = libc::EV_ADD | libc::EV_ENABLE;
            change.fflags = libc::NOTE_EXIT;

            // Re-checks getppid() and either triggers shutdown (parent gone —
            // reparented to launchd) or leaves the watchdog inactive (parent
            // alive but kqueue unusable: never kill a live session on a guess).
            let resolve_failure = |what: &str| {
                // SAFETY: see getppid() above.
                let now = unsafe { libc::getppid() };
                if now != ppid {
                    // Trigger before logging — see BestEffortStderr.
                    shutdown.trigger();
                    tracing::info!("parent {ppid} died during watchdog {what}; triggering shutdown");
                } else {
                    tracing::warn!("watchdog {what} failed with parent {ppid} still alive; watchdog inactive");
                }
            };

            // SAFETY: `change` points to one properly initialized kevent;
            // eventlist is empty (nevents = 0); no timeout pointer is read.
            let rc = unsafe { libc::kevent(kq, &change, 1, std::ptr::null_mut(), 0, std::ptr::null()) };
            if rc < 0 {
                // Most likely ESRCH: the parent died (and was reaped) between
                // getppid() and registration.
                resolve_failure("registration");
                // SAFETY: kq is a valid fd owned by this thread.
                unsafe { libc::close(kq) };
                return;
            }

            // Registration raced against parent death: if the parent died in
            // the window, the watch may be bound to a reaped (or reused) PID
            // and would never fire. getppid() is the ground truth.
            // SAFETY: see getppid() above.
            let now = unsafe { libc::getppid() };
            if now != ppid {
                // Trigger before logging — see BestEffortStderr.
                shutdown.trigger();
                tracing::info!("parent {ppid} died before watchdog registration; triggering shutdown");
                // SAFETY: kq is a valid fd owned by this thread.
                unsafe { libc::close(kq) };
                return;
            }

            loop {
                // SAFETY: changelist is empty (nchanges = 0); `event` is a
                // valid out-slot for exactly one kevent; no timeout pointer.
                let mut event: libc::kevent = unsafe { std::mem::zeroed() };
                let n = unsafe { libc::kevent(kq, std::ptr::null(), 0, &mut event, 1, std::ptr::null()) };
                if n < 0 {
                    let err = std::io::Error::last_os_error();
                    if err.raw_os_error() == Some(libc::EINTR) {
                        continue;
                    }
                    resolve_failure("wait");
                    break;
                }
                if n > 0 {
                    // Trigger before logging: the parent just died, so the
                    // stderr pipe it held is broken — see BestEffortStderr.
                    shutdown.trigger();
                    tracing::info!("parent {ppid} exited; triggering shutdown");
                    break;
                }
            }
            // SAFETY: kq is a valid fd owned by this thread.
            unsafe { libc::close(kq) };
        });

    if let Err(e) = spawned {
        tracing::warn!(error = ?e, "failed to spawn parent-death watchdog thread; watchdog inactive");
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
