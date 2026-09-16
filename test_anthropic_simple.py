import os
import anthropic
from dotenv import load_dotenv

load_dotenv("backend/.env")

api_key = os.environ.get("ANTHROPIC_API_KEY")
print(f"Key exists: {bool(api_key)}")
if api_key:
    client = anthropic.Anthropic(api_key=api_key)
    try:
        message = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=100,
            messages=[{"role": "user", "content": "Hello!"}]
        )
        print(f"Response: {message.content[0].text}")
    except Exception as e:
        print(f"Error: {e}")
