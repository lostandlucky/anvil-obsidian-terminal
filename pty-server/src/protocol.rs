use anyhow::{Result, anyhow};
use base64::{Engine, engine::general_purpose::STANDARD as B64};
use serde::{Deserialize, Serialize};

#[derive(Debug)]
pub enum ClientMessage {
    Input(Vec<u8>),
    Resize { cols: u16, rows: u16 },
}

#[derive(Debug)]
pub enum ServerMessage {
    Output(Vec<u8>),
    Exit { status: Option<i32>, signal: Option<i32> },
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum ClientWire {
    Input { data: String },
    Resize { cols: u16, rows: u16 },
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum ServerWire<'a> {
    Output { data: &'a str },
    Exit { status: Option<i32>, signal: Option<i32> },
}

impl ServerMessage {
    pub fn to_json(&self) -> String {
        match self {
            ServerMessage::Output(bytes) => {
                let encoded = B64.encode(bytes);
                serde_json::to_string(&ServerWire::Output { data: &encoded }).unwrap()
            }
            ServerMessage::Exit { status, signal } => serde_json::to_string(&ServerWire::Exit {
                status: *status,
                signal: *signal,
            })
            .unwrap(),
        }
    }
}

impl ClientMessage {
    pub fn parse(s: &str) -> Result<Self> {
        let wire: ClientWire = serde_json::from_str(s)
            .map_err(|e| anyhow!("invalid client message: {e}"))?;
        Ok(match wire {
            ClientWire::Input { data } => {
                let bytes = B64
                    .decode(data.as_bytes())
                    .map_err(|e| anyhow!("invalid base64 in input: {e}"))?;
                ClientMessage::Input(bytes)
            }
            ClientWire::Resize { cols, rows } => ClientMessage::Resize { cols, rows },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_input_message() {
        let json = r#"{"type":"input","data":"aGVsbG8="}"#;
        let msg = ClientMessage::parse(json).unwrap();
        match msg {
            ClientMessage::Input(bytes) => assert_eq!(bytes, b"hello"),
            _ => panic!("expected Input variant"),
        }
    }

    #[test]
    fn output_message_round_trips() {
        let msg = ServerMessage::Output(b"hello world".to_vec());
        let json = msg.to_json();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "output");
        assert_eq!(parsed["data"], "aGVsbG8gd29ybGQ=");
    }

    #[test]
    fn exit_message_serializes() {
        let msg = ServerMessage::Exit { status: Some(0), signal: None };
        let json = msg.to_json();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "exit");
        assert_eq!(parsed["status"], 0);
        assert!(parsed["signal"].is_null());
    }

    #[test]
    fn rejects_unknown_type() {
        let json = r#"{"type":"bogus","data":"xx"}"#;
        assert!(ClientMessage::parse(json).is_err());
    }

    #[test]
    fn rejects_malformed_json() {
        assert!(ClientMessage::parse("{not json").is_err());
    }

    #[test]
    fn rejects_invalid_base64_in_input() {
        let json = r#"{"type":"input","data":"!!!not base64!!!"}"#;
        assert!(ClientMessage::parse(json).is_err());
    }

    #[test]
    fn parses_resize_message() {
        let json = r#"{"type":"resize","cols":120,"rows":40}"#;
        let msg = ClientMessage::parse(json).unwrap();
        match msg {
            ClientMessage::Resize { cols, rows } => {
                assert_eq!(cols, 120);
                assert_eq!(rows, 40);
            }
            _ => panic!("expected Resize variant"),
        }
    }
}
