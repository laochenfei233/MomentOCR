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
        // MiMo 等部分网关使用 api-key 头；标准 OpenAI 兼容服务会忽略多余头
        .header("api-key", api_key)
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
    let content_array = serde_json::json!([image_content, text_content]);
    let message = Message { role: "user".to_string(), content: content_array };
    let body = RequestBody {
        model: model.to_string(),
        messages: vec![message],
        max_tokens,
    };

    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let response = client
        .post(&url)
        .bearer_auth(api_key)
        // MiMo 等部分网关使用 api-key 头；标准 OpenAI 兼容服务会忽略多余头
        .header("api-key", api_key)
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
    struct VisionResponse {
        choices: Vec<Choice>,
    }

    let parsed: VisionResponse = serde_json::from_str(&response_text)
        .map_err(|e| anyhow::anyhow!("Failed to parse response: {}. Response: {}", e, response_text))?;

    parsed.choices.first()
        .map(|c| c.message.content.clone())
        .ok_or_else(|| anyhow::anyhow!("No choices in response"))
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

/// Anthropic Claude 翻译（Messages API，非 OpenAI 兼容）
pub async fn call_claude_translate(
    base_url: &str,
    api_key: &str,
    model: &str,
    text: &str,
    target_lang: &str,
) -> Result<String, anyhow::Error> {
    let base = base_url.trim().trim_end_matches('/');
    let base = if base.is_empty() { "https://api.anthropic.com/v1" } else { base };
    let client = Client::new();

    #[derive(Serialize)]
    struct Message {
        role: String,
        content: String,
    }
    #[derive(Serialize)]
    struct RequestBody {
        model: String,
        max_tokens: u32,
        system: String,
        messages: Vec<Message>,
    }

    let body = RequestBody {
        model: model.to_string(),
        max_tokens: 4096,
        system: "你是一个专业翻译助手。只返回翻译结果，不要添加任何解释或额外内容。".to_string(),
        messages: vec![Message {
            role: "user".to_string(),
            content: format!("请将以下文本翻译为{}。\n\n{}", target_lang, text),
        }],
    };

    let response = client
        .post(format!("{}/messages", base))
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await?;

    let response_text = response.text().await?;

    #[derive(Deserialize)]
    struct ContentBlock {
        #[serde(rename = "type")]
        block_type: String,
        text: Option<String>,
    }
    #[derive(Deserialize)]
    struct ClaudeResponse {
        content: Vec<ContentBlock>,
    }

    let parsed: ClaudeResponse = serde_json::from_str(&response_text)
        .map_err(|e| anyhow::anyhow!("Failed to parse Claude response: {}. Response: {}", e, response_text))?;

    let text: String = parsed
        .content
        .iter()
        .filter(|b| b.block_type == "text")
        .filter_map(|b| b.text.clone())
        .collect::<Vec<_>>()
        .join("");

    if text.is_empty() {
        Err(anyhow::anyhow!("Claude 返回空结果"))
    } else {
        Ok(text)
    }
}

/// Anthropic Claude 视觉 OCR（Messages API + image block）
pub async fn call_claude_vision(
    base_url: &str,
    api_key: &str,
    model: &str,
    image_base64: &str,
    max_tokens: u32,
) -> Result<String, anyhow::Error> {
    let base = base_url.trim().trim_end_matches('/');
    let base = if base.is_empty() { "https://api.anthropic.com/v1" } else { base };
    let client = Client::new();

    let body = serde_json::json!({
        "model": model,
        "max_tokens": max_tokens,
        "messages": [{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": image_base64
                    }
                },
                {
                    "type": "text",
                    "text": "Please extract all text from this image and return it as-is. If the text appears to be in a specific language, just return the original text without translation."
                }
            ]
        }]
    });

    let response = client
        .post(format!("{}/messages", base))
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await?;

    let response_text = response.text().await?;

    #[derive(Deserialize)]
    struct ContentBlock {
        #[serde(rename = "type")]
        block_type: String,
        text: Option<String>,
    }
    #[derive(Deserialize)]
    struct ClaudeResponse {
        content: Vec<ContentBlock>,
    }

    let parsed: ClaudeResponse = serde_json::from_str(&response_text)
        .map_err(|e| anyhow::anyhow!("Failed to parse Claude response: {}. Response: {}", e, response_text))?;

    let text: String = parsed
        .content
        .iter()
        .filter(|b| b.block_type == "text")
        .filter_map(|b| b.text.clone())
        .collect::<Vec<_>>()
        .join("");

    if text.is_empty() {
        Err(anyhow::anyhow!("Claude 返回空结果"))
    } else {
        Ok(text)
    }
}

/// 拉取模型列表。
/// provider: "openai"（OpenAI 兼容 /models）、"anthropic"（Claude /models）、"ollama"（/api/tags）
pub async fn list_models(
    base_url: &str,
    api_key: &str,
    provider: &str,
) -> Result<Vec<String>, anyhow::Error> {
    let client = Client::new();

    if provider == "ollama" {
        let base = base_url.trim().trim_end_matches('/');
        let url = if base.is_empty() { "http://localhost:11434/api/tags".to_string() } else { format!("{}/api/tags", base) };
        let response = client.get(&url).send().await?;
        let response_text = response.text().await?;
        #[derive(Deserialize)]
        struct OllamaTag { name: String }
        #[derive(Deserialize)]
        struct OllamaTags { models: Vec<OllamaTag> }
        let parsed: OllamaTags = serde_json::from_str(&response_text)
            .map_err(|e| anyhow::anyhow!("解析 Ollama 模型列表失败: {}. Response: {}", e, response_text))?;
        return Ok(parsed.models.into_iter().map(|m| m.name).collect());
    }

    let base = base_url.trim().trim_end_matches('/');
    let url = format!("{}/models", base);

    let mut request = client.get(&url);
    if provider == "anthropic" {
        request = request
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01");
    } else {
        request = request.bearer_auth(api_key).header("api-key", api_key);
    }

    let response = request.send().await?;
    let status = response.status();
    let response_text = response.text().await?;

    if !status.is_success() {
        return Err(anyhow::anyhow!("拉取模型列表失败 ({}): {}", status, response_text));
    }

    #[derive(Deserialize)]
    struct ModelItem { id: String }
    #[derive(Deserialize)]
    struct ModelList { data: Vec<ModelItem> }

    let parsed: ModelList = serde_json::from_str(&response_text)
        .map_err(|e| anyhow::anyhow!("解析模型列表失败: {}. Response: {}", e, response_text))?;

    Ok(parsed.data.into_iter().map(|m| m.id).collect())
}

/// Read image file and encode to base64
pub fn image_to_base64(path: &str) -> Result<String, anyhow::Error> {
    let data = fs::read(path)?;
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&data))
}
