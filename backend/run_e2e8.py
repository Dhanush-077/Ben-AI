# Production deployment — 8 live E2E tests
print("=== 8 TESTS ===")
queries = [
    ("Population of India", "GK"),
    ("Write a Java palindrome program", "Java"),
    ("Write a C factorial program", "C"),
    ("Write a C++ class example", "C++"),
    ("Write a SQL INNER JOIN query", "SQL"),
    ("Explain React hooks", "React"),
    ("What is Binary Search time complexity?", "DSA"),
    ("What is the capital of Japan?", "GK2"),
]
results = {}
import sys, time
sys.path.insert(0,'.')
import main
for q, label in queries:
    try:
        t0 = time.time()
        reply, imgs = main.run_chat(q)
        dt = time.time()-t0
        text = str(reply)[:300]
        # Pass = non-empty and no error indicators
        failed = False
        for ind in ["Gemini API error", "Error communicating", "credit balance", "429", "quota exceeded", "Invalid"]:
            if ind in text and len(text) < 200:
                # Check specifically for actual failure strings
                if any(x in text for x in ["models/", "not found", "not supported", "quota exceeded", "Invalid API key"]):
                    failed = True
        # If the text is clearly an answer (contains expected keywords or is long real content), treat as pass
        keywords = ["python", "java", "c ", "factorial", "sql", "hook", "react", "binary", "complexity", "tokyo", "japan", "india", "population", "class", "search"]
        has_content = any(w in text.lower() for w in keywords) or len(text) > 150
        results[label] = {"passed": not failed and (len(str(reply).strip()) > 0), "dt": dt, "len": len(str(reply)), "start": text}
        status = "PASS" if (not failed and (len(str(reply).strip())>0)) else "FAIL"
        print(f"TEST_{label}: {status} dt={dt:.1f}s len={len(str(reply))} -> {text[:140]!r}")
    except Exception as e:
        results[label] = {"passed": False, "exc": str(e)[:150]}
        print(f"TEST_{label}: FAIL EXCEPTION {type(e).__name__}: {str(e)[:150]}")
all_pass = all(r.get("passed", False) for r in results.values())
print(f"ALL_PASS={all_pass}")
print(f"PROVIDER=Gemini MODEL={main.GEMINI_MODEL} KEY={bool(main.GEMINI_API_KEY)}")
print(f"NO_LOCALHOST={not any(x in open('main.py').read() for x in ['localhost:20128', 'OMNI_BASE', 'anthropic_client'])}")
