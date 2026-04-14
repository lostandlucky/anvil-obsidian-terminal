use anyhow::{Result, anyhow};
use base64::{Engine, engine::general_purpose::STANDARD as B64};
use serde::Deserialize;

#[derive(Debug)]
pub enum ClientMessage {
    Input(Vec<u8>),
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum ClientWire {
    Input { data: String },
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
        }
    }
}
