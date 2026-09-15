import sys, time
sys.path.insert(0,'.')
import main
print('PROVIDER=Gemini MODEL=', main.GEMINI_MODEL, 'KEY=', bool(main.GEMINI_API_KEY))
queries = [
    ('Population of India','POP'),
    ('Capital of Japan','CAP'),
    ('Write a Python palindrome program','PY'),
    ('Explain React hooks','REACT'),
]
results = {}
for q,lab in queries:
    try:
        t0 = time.time()
        reply, imgs = main.run_chat(q)
        dt = time.time()-t0
        text = str(reply)[:320]
        failed = False
        for ind in ['quota', 'API key not valid', 'Invalid API key', 'Invalid argument', 'Invalid request', 'Could not resolve']:
            if ind in text: failed = True; print('FAIL '+lab+' indicator: '+ind)
        if len(str(reply).strip()) < 8 and len(str(reply).strip()) > 0: failed = True; print('FAIL '+lab+' short reply')
        results[lab] = {'passed': not failed, 'text': text, 'dt': dt, 'len': len(str(reply))}
        print('TEST_'+lab+' PASS=' + str(not failed) + ' dt=' + str(round(dt,1)) + 's len=' + str(len(str(reply))) + ' START=' + repr(text[:200]))
    except Exception as e:
        results[lab] = {'passed': False, 'exc': str(e)[:180]}
        print('FAIL_'+lab+' EXCEPTION: '+type(e).__name__+': '+str(e)[:180])
all_pass = all(r['passed'] for r in results.values())
print('ALL_PASS=', all_pass)
for lab in results:
    r = results[lab]
    status = 'PASS' if r['passed'] else 'FAIL'
    text_preview = r.get('text', r.get('exc', ''))
    print('  '+lab+': '+status+' len='+str(r.get('len',0))+' dt='+str(round(r.get('dt',0),1))+' reply='+repr(text_preview[:120]))
