# 🤖 Francesca AI - WhatsApp Assistant Core

Francesca is an advanced virtual assistant based on artificial intelligence, integrated directly into WhatsApp. It uses state-of-the-art Large Language Models (LLMs) to interact naturally, manage documents, analyze images, and process voice messages.

## 🚀 Key Features

- **WhatsApp Integration:** Built on the `baileys` library, ensuring a stable and responsive connection.
- **Multi-Model Brain:** Dynamic routing between various AI models via LiteLLM Proxy:
  - **Llama 3.3 (70B):** For standard, high-speed conversations.
  - **DeepSeek R1:** For complex reasoning and advanced logic.
  - **Gemini Vision:** For image and PDF document analysis.
  - **Ollama (Dolphin):** For private, local execution.
- **Document Management & OCR:** Automatic archiving of PDFs and images with intelligent text extraction and summarization.
- **Voice Interface:** Speech-to-Text (STT) and Text-to-Speech (TTS) with natural-sounding voices (Microsoft Edge TTS).
- **Escalation System:** If Francesca is unsure of an answer, she forwards the request to the "Boss" (Administrator), who can respond directly using quick options (1, 2, 3).
- **Semantic Memory:** Local vector database to remember past conversations and relevant information.
- **Tools:** Capability to execute terminal commands, generate graphics, and manage hardware (if configured).

## 🛠️ Requirements

- Node.js v18+
- A dedicated WhatsApp account.
- API Keys for the services used (Groq, OpenAI, Google, etc.) configured via LiteLLM.
- (Optional) Ollama for running local models.

## ⚙️ Installation

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure the `.env` file (referencing `.env.example`).
4. Configure `config.yaml` to define AI models and master keys.

## 🚦 Getting Started

To start the server and connect the bot:

```bash
node index.mjs
```

On the first run, scan the QR code that appears in the terminal using your WhatsApp app.

## 📁 Project Structure

- `index.mjs`: Main entry point and WhatsApp logic.
- `src/modules/`: Core modules (brain, ear, voice, documents, memory, etc.).
- `src/tools/`: Extended functions usable by the AI.
- `config.yaml`: AI model configuration.
- `database.json` / `vector_db.json`: Memory and data persistence.

---

*Developed with ❤️ for an unprecedented AI experience.*
