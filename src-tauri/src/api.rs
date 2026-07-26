use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::fs;

// OpenAI Vision API
pub async fn call_openai_vision(
    api_key: &str,
    image_base64: &str,
    model: &str,
    max_tokens: u32,
) -> Result<String, anyhow::Error> {
    let client = Client::new();

    #[derive(Serialize)]
    struct ImageUrl {
        url: String,
    }

    #[derive(Serialize)]
    struct ImageContent {
        #[serde(rename = "type")]
        content_type: String,
        image_url: ImageUrl,
    }

    #[derive(Serialize)]
    struct TextContent {
        #[serde(rename = "type")]
        content_type: String,
        text: String,
    }

    #[derive(Serialize)]
    struct Message {
        role: String,
        content: serde_json::Value,
    }

    #[derive(Serialize)]
    struct RequestBody {
        model: String,
        messages: Vec<Message>,
        max_tokens: u32,
    }

    let image_content = ImageContent {
        content_type: "image_url".to_string(),
        image_url: ImageUrl {
            url: format!("data:image/png;base64,{}", image_base64),
        },
    };

    let text_content = TextContent {
        content_type: "text".to_string(),
        text: "Please extract all text from this image and return it as-is. If the text appears to be in a specific language, just return the original text without translation.".to_string(),
    };

    let content_array = serde_json::json!([
        image_content,
        text_content
    ]);

    let message = Message {
        role: "user".to_string(),
        content: content_array,
    };

    let body = RequestBody {
        model: model.to_string(),
        messages: vec![message],
        max_tokens,
    };

    let response = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await?;

    let response_text = response.text().await?;

    #[derive(Deserialize)]
    struct Choice {
        message: ChoiceMessage,
    }

    #[derive(Deserialize)]
    struct ChoiceMessage {
        content: String,
    }

    #[derive(Deserialize)]
    struct OpenAIResponse {
        choices: Vec<Choice>,
    }

    let parsed: OpenAIResponse = serde_json::from_str(&response_text)
        .map_err(|e| anyhow::anyhow!("Failed to parse OpenAI response: {}. Response: {}", e, response_text))?;

    parsed
        .choices
        .first()
        .map(|c| c.message.content.clone())
        .ok_or_else(|| anyhow::anyhow!("No choices in OpenAI response"))
}

// Ollama API
pub async fn call_ollama(
    endpoint: &str,
    model: &str,
    image_base64: &str,
) -> Result<String, anyhow::Error> {
    let client = Client::new();

    #[derive(Serialize)]
    struct OllamaRequest {
        model: String,
        prompt: String,
        images: Vec<String>,
        stream: bool,
    }

    let body = OllamaRequest {
        model: model.to_string(),
        prompt: "Please extract all text from this image and return it as-is. If the text appears to be in a specific language, just return the original text without translation.".to_string(),
        images: vec![image_base64.to_string()],
        stream: false,
    };

    let url = format!("{}/api/generate", endpoint.trim_end_matches('/'));

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await?;

    let response_text = response.text().await?;

    #[derive(Deserialize)]
    struct OllamaResponse {
        response: String,
    }

    let parsed: OllamaResponse = serde_json::from_str(&response_text)
        .map_err(|e| anyhow::anyhow!("Failed to parse Ollama response: {}. Response: {}", e, response_text))?;

    Ok(parsed.response)
}

// Google Translate (using free API alternative)
pub async fn call_google_translate(
    text: &str,
    target_lang: &str,
) -> Result<String, anyhow::Error> {
    let client = Client::new();

    // Using the free Google Translate API endpoint (no key required for basic usage)
    let url = format!(
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl={}&dt=t&q={}",
        target_lang,
        urlencoding::encode(text)
    );

    let response = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .send()
        .await?;

    let response_text = response.text().await?;

    // Parse the nested array response
    let parsed: serde_json::Value = serde_json::from_str(&response_text)
        .map_err(|e| anyhow::anyhow!("Failed to parse Google Translate response: {}", e))?;

    // Extract translated text from the nested structure
    let mut translated = String::new();
    if let Some(sentences) = parsed.get(0).and_then(|v| v.as_array()) {
        for sentence in sentences {
            if let Some(translated_part) = sentence.get(0).and_then(|v| v.as_str()) {
                translated.push_str(translated_part);
            }
        }
    }

    if translated.is_empty() {
        return Err(anyhow::anyhow!("No translation result found"));
    }

    Ok(translated)
}

// AI Translate (using OpenAI or Ollama for translation)
pub async fn call_ai_translate(
    api_key: &str,
    text: &str,
    target_lang: &str,
    model: &str,
    provider: &str,
) -> Result<String, anyhow::Error> {
    match provider.to_lowercase().as_str() {
        "openai" => {
            let client = Client::new();

            #[derive(Serialize)]
            struct Message {
                role: String,
                content: String,
            }

            #[derive(Serialize)]
            struct RequestBody {
                model: String,
                messages: Vec<Message>,
                temperature: f64,
            }

            let prompt = format!(
                "Translate the following text to {}. Return ONLY the translation, nothing else.\n\nText:\n{}",
                target_lang, text
            );

            let body = RequestBody {
                model: model.to_string(),
                messages: vec![Message {
                    role: "user".to_string(),
                    content: prompt,
                }],
                temperature: 0.3,
            };

            let response = client
                .post("https://api.openai.com/v1/chat/completions")
                .header("Authorization", format!("Bearer {}", api_key))
                .header("Content-Type", "application/json")
                .json(&body)
                .send()
                .await?;

            let response_text = response.text().await?;

            #[derive(Deserialize)]
            struct Choice {
                message: ChoiceMessage,
            }

            #[derive(Deserialize)]
            struct ChoiceMessage {
                content: String,
            }

            #[derive(Deserialize)]
            struct OpenAIResponse {
                choices: Vec<Choice>,
            }

            let parsed: OpenAIResponse = serde_json::from_str(&response_text)
                .map_err(|e| anyhow::anyhow!("Failed to parse OpenAI response: {}", e))?;

            parsed
                .choices
                .first()
                .map(|c| c.message.content.clone())
                .ok_or_else(|| anyhow::anyhow!("No translation result"))
        }
        "ollama" => {
            // For Ollama, we use the endpoint as the base URL
            // The caller should pass the endpoint in api_key field for simplicity
            let endpoint = api_key; // Reusing api_key field for endpoint
            let client = Client::new();

            #[derive(Serialize)]
            struct OllamaRequest {
                model: String,
                prompt: String,
                stream: bool,
            }

            let prompt = format!(
                "Translate the following text to {}. Return ONLY the translation, nothing else.\n\nText:\n{}",
                target_lang, text
            );

            let body = OllamaRequest {
                model: model.to_string(),
                prompt,
                stream: false,
            };

            let url = format!("{}/api/generate", endpoint.trim_end_matches('/'));

            let response = client
                .post(&url)
                .header("Content-Type", "application/json")
                .json(&body)
                .send()
                .await?;

            let response_text = response.text().await?;

            #[derive(Deserialize)]
            struct OllamaResponse {
                response: String,
            }

            let parsed: OllamaResponse = serde_json::from_str(&response_text)
                .map_err(|e| anyhow::anyhow!("Failed to parse Ollama response: {}", e))?;

            Ok(parsed.response)
        }
        _ => Err(anyhow::anyhow!("Unsupported provider: {}", provider)),
    }
}

/// Read image file and encode to base64
pub fn image_to_base64(path: &str) -> Result<String, anyhow::Error> {
    let data = fs::read(path)?;
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&data))
}

/// 通用大模型翻译：OpenAI 兼容协议
pub async fn call_custom_translate(
    base_url: &str,
    api_key: &str,
    model: &str,
    text: &str,
    target_lang: &str,
) -> Result<String, anyhow::Error> {
    let trimmed = base_url.trim();
    if trimmed.is_empty() {
        return Err(anyhow::anyhow!("base_url 不能为空，请在设置中配置翻译服务的 Base URL"));
    }

    let client = Client::new();

    #[derive(Serialize)]
    struct Message {
        role: String,
        content: String,
    }
    #[derive(Serialize)]
    struct RequestBody {
        model: String,
        messages: Vec<Message>,
        temperature: f64,
    }

    let prompt = format!(
        "请将以下文本翻译为{}。只返回翻译结果，不要添加任何解释或额外内容。\n\n{}\n",
        target_lang, text
    );

    let body = RequestBody {
        model: model.to_string(),
        messages: vec![
            Message { role: "system".to_string(), content: "你是一个专业翻译助手。".to_string() },
            Message { role: "user".to_string(), content: prompt },
        ],
        temperature: 0.3,
    };

    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let response = client
        .post(&url)
        .bearer_auth(api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await?;

    let response_text = response.text().await?;

    #[derive(Deserialize)]
    struct Choice {
        message: ChoiceMessage,
    }
    #[derive(Deserialize)]
    struct ChoiceMessage {
        content: String,
    }
    #[derive(Deserialize)]
    struct ChatResponse {
        choices: Vec<Choice>,
    }

    let parsed: ChatResponse = serde_json::from_str(&response_text)
        .map_err(|e| anyhow::anyhow!("Failed to parse translation response: {}. Response: {}", e, response_text))?;

    parsed.choices.first()
        .map(|c| c.message.content.clone())
        .ok_or_else(|| anyhow::anyhow!("No choices in translation response"))
}

/// 通用大模型 OCR：OpenAI 兼容协议（base_url 可指向通义/智谱/豆包/Gemini 等）
pub async fn call_custom_vision(
    base_url: &str,
    api_key: &str,
    model: &str,
    image_base64: &str,
    max_tokens: u32,
) -> Result<String, anyhow::Error> {
    let trimmed = base_url.trim();
    if trimmed.is_empty() {
        return Err(anyhow::anyhow!("base_url 不能为空，请在设置中配置 OCR 服务的 Base URL"));
    }

    let client = Client::new();

    #[derive(Serialize)]
    struct ImageUrl {
        url: String,
    }
    #[derive(Serialize)]
    struct ImageContent {
        #[serde(rename = "type")]
        content_type: String,
        image_url: ImageUrl,
    }
    #[derive(Serialize)]
    struct TextContent {
        #[serde(rename = "type")]
        content_type: String,
        text: String,
    }
    #[derive(Serialize)]
    struct Message {
        role: String,
        content: serde_json::Value,
    }
    #[derive(Serialize)]
    struct RequestBody {
        model: String,
        messages: Vec<Message>,
        max_tokens: u32,
    }

    let image_content = ImageContent {
        content_type: "image_url".to_string(),
        image_url: ImageUrl {
            url: format!("data:image/png;base64,{}", image_base64),
        },
    };

    let text_content = TextContent {
        content_type: "text".to_string(),
        text: "Please extract all text from this image and return it as-is. If the text appears to be in a specific language, just return the original text without translation.".to_string(),
    };

    let content_array = serde_json::json!([
        image_content,
        text_content
    ]);

    let message = Message {
        role: "user".to_string(),
        content: content_array,
    };

    let body = RequestBody {
        model: model.to_string(),
        messages: vec![message],
        max_tokens,
    };

    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let response = client
        .post(&url)
        .bearer_auth(api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await?;

    let response_text = response.text().await?;

    #[derive(Deserialize)]
    struct Choice {
        message: ChoiceMessage,
    }
    #[derive(Deserialize)]
    struct ChoiceMessage {
        content: String,
    }
    #[derive(Deserialize)]
    struct ChatResponse {
        choices: Vec<Choice>,
    }

    let parsed: ChatResponse = serde_json::from_str(&response_text)
        .map_err(|e| anyhow::anyhow!("Failed to parse OCR response: {}. Response: {}", e, response_text))?;

    parsed.choices.first()
        .map(|c| c.message.content.clone())
        .ok_or_else(|| anyhow::anyhow!("No choices in OCR response"))
}
