# ARCHITECTURE

User ↓ SCTH Website ↓ Elsah AI Service ├─ Knowledge Base ├─ Conversation
Memory ├─ AI Router │ ├─ Gemini │ ├─ Groq │ └─ OpenRouter └─ Response
Engine

All AI requests pass through the AI Router, enabling provider fallback
without changing application logic.
