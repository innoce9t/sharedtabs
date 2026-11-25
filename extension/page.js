// Injected into the isolated world of pages agents are allowed to use. The page cannot see or change it.
globalThis.__hermes ??= (() => {
  const prefix = crypto.getRandomValues(new Uint32Array(1))[0].toString(36); // new per document, so stale refs never match
  const byRef = new Map();
  const refs = new WeakMap();
  let n = 0;

  function refFor(el) {
    let r = refs.get(el);
    if (!r) {
      r = `${prefix}_${++n}`;
      refs.set(el, r);
      byRef.set(r, new WeakRef(el));
    }
    return r;
  }
  function find(ref) {
    const el = byRef.get(ref)?.deref();
    if (!el?.isConnected) throw new Error(`Element ${ref} is no longer on the page. Call read_page again.`);
    return el;
  }

  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'SVG', 'svg']);
  const ROLES = {
    A: 'link', BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox', IMG: 'image', NAV: 'navigation', MAIN: 'main',
    HEADER: 'header', FOOTER: 'footer', FORM: 'form', UL: 'list', OL: 'list', LI: 'listitem', TABLE: 'table', TR: 'row',
    TD: 'cell', TH: 'columnheader', H1: 'heading1', H2: 'heading2', H3: 'heading3', H4: 'heading4', H5: 'heading5', H6: 'heading6',
    DIALOG: 'dialog', SUMMARY: 'button', IFRAME: 'iframe', LABEL: 'label', VIDEO: 'video', AUDIO: 'audio',
  };
  const INPUT = { checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button', image: 'button', range: 'slider' };
  const INTERACTIVE = new Set(['link', 'button', 'combobox', 'textbox', 'checkbox', 'radio', 'slider', 'switch', 'tab', 'menuitem', 'option', 'searchbox', 'spinbutton', 'menuitemcheckbox', 'menuitemradio', 'treeitem']);

  function roleOf(el) {
    const r = el.getAttribute('role');
    if (r) return r.split(' ')[0];
    if (el.tagName === 'INPUT') return INPUT[el.type] || 'textbox';
    if (el.tagName === 'A' && !el.hasAttribute('href')) return '';
    return ROLES[el.tagName] || (el.isContentEditable && !el.parentElement?.isContentEditable ? 'textbox' : '');
  }
  function isInteractive(el, role) {
    return INTERACTIVE.has(role) || el.hasAttribute('onclick') || (el.hasAttribute('tabindex') && el.tabIndex >= 0);
  }
  function visible(el) {
    if (el.checkVisibility) return el.checkVisibility({ visibilityProperty: true, opacityProperty: true, contentVisibilityAuto: true });
    return true;
  }
  const squash = (s) => (s || '').replace(/\s+/g, ' ').trim();
  function nameOf(el) {
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = squash(by.split(/\s+/).map((id) => el.getRootNode().getElementById?.(id)?.textContent || '').join(' '));
      if (t) return t;
    }
    return squash(el.getAttribute('aria-label') || (el.labels?.[0]?.textContent) || el.getAttribute('alt')
      || el.getAttribute('placeholder') || el.getAttribute('title')
      || (['submit', 'button', 'reset'].includes(el.type) && el.tagName === 'INPUT' ? el.value : '') || '');
  }

  /** Why agents must not read or fill this field, or null. */
  function sensitive(el) {
    if (!el || !('tagName' in el)) return null;
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (el.type === 'password' || /(current|new)-password/.test(ac)) return 'password field';
    if (/one-time-code/.test(ac)) return 'one-time code field';
    if (/\bcc-/.test(ac)) return 'payment card field';
    const id = `${el.name || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('placeholder') || ''}`.toLowerCase();
    if (/passw(or)?d|passcode/.test(id)) return 'password field';
    if (/card.?(number|num|no)\b|\bcvv2?\b|\bcvc\b|security.?code/.test(id)) return 'payment card field';
    if (/\bssn\b|social.?security/.test(id)) return 'government ID field';
    if (/\botp\b|verification.?code|one.?time.?(code|pass)/.test(id)) return 'one-time code field';
    return null;
  }

  const isFrame = (el) => !!el && ['IFRAME', 'FRAME', 'OBJECT', 'EMBED'].includes(el.tagName);
  function fileLine(el) {
    const bits = ['file input', JSON.stringify(nameOf(el) || el.name || el.id || ''), `[ref=${refFor(el)}]`];
    if (el.accept) bits.push(`accept=${JSON.stringify(el.accept.slice(0, 120))}`);
    if (el.multiple) bits.push('multiple');
    if (el.files.length) bits.push(`files=${JSON.stringify([...el.files].map((f) => f.name))}`);
    if (el.disabled) bits.push('disabled');
    return bits.join(' ');
  }

  function children(el) {
    if (el.tagName === 'SLOT') { const a = el.assignedNodes(); if (a.length) return a; }
    return (el.shadowRoot || el).childNodes;
  }

  function read({ filter = 'all', ref, maxChars = 20000 }) {
    const only = filter === 'interactive';
    const lines = [];
    let size = 0;
    let truncated = false;
    const seen = new Set();
    const push = (depth, s) => {
      if (truncated) return;
      const line = '  '.repeat(Math.min(depth, 12)) + s;
      size += line.length + 1;
      if (size > maxChars) { truncated = true; return; }
      lines.push(line);
    };
    const walk = (node, depth) => {
      if (truncated) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const t = squash(node.data);
        if (t && !only) push(depth, t.slice(0, 1000));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE || SKIP.has(node.tagName) || node.getAttribute('aria-hidden') === 'true') return;
      if (node.tagName === 'INPUT' && node.type === 'file') { seen.add(node); push(depth, fileLine(node)); return; }
      if (!visible(node) && getComputedStyle(node).display !== 'contents') return;
      const role = roleOf(node);
      const act = isInteractive(node, role);
      let inner = depth;
      if ((role || act) && (!only || act)) {
        const bits = [role || 'clickable'];
        let name = nameOf(node);
        let whole = false; // the name already says everything inside this element
        if (!name && act && !['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName)) {
          name = squash(node.innerText);
          whole = name.length <= 200 && !node.shadowRoot && !node.querySelector('a,button,input,select,textarea,img,iframe,[role],[tabindex],[onclick]');
        }
        if (name) bits.push(JSON.stringify(name.slice(0, 200)));
        if (act || role === 'form' || role === 'dialog') bits.push(`[ref=${refFor(node)}]`);
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName)) {
          const why = sensitive(node);
          if (node.type === 'checkbox' || node.type === 'radio') bits.push(node.checked ? 'checked' : 'unchecked');
          else if (why) bits.push(`(${why}, hidden)`);
          else if (node.type === 'hidden') return;
          else if (node.tagName === 'SELECT') {
            bits.push(`selected=${JSON.stringify([...node.selectedOptions].map((o) => squash(o.label)).join(', '))}`);
            bits.push(`options=${JSON.stringify([...node.options].slice(0, 40).map((o) => squash(o.label)))}`);
          } else if (node.value && !['submit', 'button', 'reset'].includes(node.type)) bits.push(`value=${JSON.stringify(node.value.slice(0, 300))}`);
          if (node.disabled) bits.push('disabled');
        }
        for (const a of ['aria-expanded', 'aria-checked', 'aria-selected', 'aria-disabled']) {
          if (node.hasAttribute(a)) bits.push(`${a.slice(5)}=${node.getAttribute(a)}`);
        }
        if (node.tagName === 'A' && node.href) bits.push(`-> ${node.href.slice(0, 200)}`);
        push(depth, bits.join(' '));
        if (whole) return;
        inner = depth + 1;
      }
      if (['SELECT', 'TEXTAREA', 'IFRAME'].includes(node.tagName)) return;
      for (const c of children(node)) walk(c, inner);
    };
    const root = ref ? find(ref) : document.body;
    if (root) walk(root, 0);
    // Upload fields are often hidden behind a styled button.
    for (const el of root?.querySelectorAll?.('input[type=file]') || []) if (!seen.has(el)) push(0, `${fileLine(el)} (hidden)`);
    return {
      prefix,
      title: document.title,
      url: location.href,
      outline: lines.join('\n') + (truncated ? '\n… (truncated; pass a ref, filter "interactive", or a larger maxChars)' : ''),
    };
  }

  function text({ maxChars = 20000 }) {
    const t = (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
    return { title: document.title, url: location.href, text: t.length > maxChars ? t.slice(0, maxChars) + '\n… (truncated)' : t };
  }

  function deepPoint(x, y) {
    let el = document.elementFromPoint(x, y);
    while (el?.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  }
  function contains(a, b) {
    for (let p = b; p; p = p.parentNode || p.host) if (p === a) return true;
    return false;
  }

  function locate(ref, scroll = true) {
    const el = find(ref);
    if (scroll) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const r = [...el.getClientRects()].find((q) => q.width > 0 && q.height > 0);
    if (!r) throw new Error(`Element ${ref} has no visible area.`);
    if (!scroll && (r.bottom < 1 || r.right < 1 || r.top > innerHeight - 2 || r.left > innerWidth - 2)) throw new Error('Both ends of the drag must be visible together.');
    const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 2);
    const y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 2);
    const hit = deepPoint(x, y);
    const label = el.labels && [...el.labels].some((l) => contains(l, hit));
    if (hit && !contains(el, hit) && !contains(hit, el) && !label) {
      throw new Error(`Element ${ref} is covered by <${hit.tagName.toLowerCase()}> ${JSON.stringify(squash(hit.textContent).slice(0, 60))}.`);
    }
    return { x, y, sensitive: sensitive(el) };
  }

  function active() {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }
  /** What typing would reach right now. */
  function focusInfo(ref, at) {
    const el = active();
    if (!el || el === document.body) return { none: true };
    if (isFrame(el)) return { frame: true };
    let matches = !ref;
    if (ref) {
      const target = byRef.get(ref)?.deref();
      if (target?.isConnected) matches = contains(target, el) || contains(el, target);
      if (!matches && at) { // some pages swap a field for a new one when it is clicked
        const r = el.getBoundingClientRect();
        matches = !target?.isConnected && at.x >= r.left && at.x <= r.right && at.y >= r.top && at.y <= r.bottom;
      }
    }
    const editable = el.isContentEditable || el.tagName === 'TEXTAREA'
      || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image', 'range', 'color'].includes(el.type));
    return { matches, editable, sensitive: sensitive(el), id: refFor(el) };
  }
  function selectAll() {
    const el = active();
    if (el.select) el.select();
    else getSelection().selectAllChildren(el);
  }

  function setValue(ref, value) {
    const el = find(ref);
    const why = sensitive(el);
    if (why) throw new Error(`That is a ${why}. Ask the user to fill it in.`);
    if (el.disabled) throw new Error('That control is disabled.');
    if (el.tagName === 'SELECT') {
      const o = [...el.options].find((q) => q.value === value) || [...el.options].find((q) => squash(q.label).toLowerCase() === squash(value).toLowerCase());
      if (!o) throw new Error(`No such option. Options: ${[...el.options].slice(0, 40).map((q) => squash(q.label)).join(', ')}`);
      el.value = o.value;
    } else if (el.tagName === 'INPUT' && ['date', 'time', 'datetime-local', 'month', 'week', 'range', 'color'].includes(el.type)) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
      if (el.value !== value && el.type !== 'range') throw new Error(`The ${el.type} input rejected that value.`);
    } else throw new Error('set_value is for selects and date, time, range or colour inputs. Use click or type_text.');
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return `Set to ${el.value}`;
  }

  // Finding which frame element holds a child document: the child posts a nonce, and the event's source
  // identifies its window without trusting URLs or names.
  const expected = new Map();
  addEventListener('message', (e) => {
    const n2 = e.data?.hermesFrame;
    if (!expected.has(n2)) return;
    e.stopImmediatePropagation();
    expected.get(n2)(e.source);
  }, true);
  function expectChild(nonce) {
    let got;
    const p = new Promise((r) => { got = r; });
    expected.set(nonce, got);
    expected.set(`p${nonce}`, p);
  }
  const callParent = (nonce) => { parent.postMessage({ hermesFrame: nonce }, '*'); };
  function allFrames(root, out = []) {
    for (const el of root.querySelectorAll('*')) {
      if (isFrame(el)) out.push(el);
      if (el.shadowRoot) allFrames(el.shadowRoot, out);
    }
    return out;
  }
  async function childElement(nonce) {
    const source = await Promise.race([expected.get(`p${nonce}`), new Promise((r) => { setTimeout(r, 2000); })]);
    expected.delete(nonce);
    expected.delete(`p${nonce}`);
    const el = source && allFrames(document).find((f) => f.contentWindow === source);
    if (!el) throw new Error('The embedded frame could not be found on the page. Call read_page again.');
    return el;
  }
  function frameOrigin(el) {
    const r = el.getBoundingClientRect();
    const c = getComputedStyle(el);
    if (c.transform !== 'none') throw new Error('The embedded frame is transformed, so it cannot be clicked reliably.');
    return { x: r.left + el.clientLeft + parseFloat(c.paddingLeft), y: r.top + el.clientTop + parseFloat(c.paddingTop), w: el.clientWidth, h: el.clientHeight };
  }
  /** Converts a point in the child to a point in this document, scrolling it into view. */
  async function childPoint(nonce, x, y) {
    const el = await childElement(nonce);
    let o = frameOrigin(el);
    const out = () => o.x + x < 1 || o.y + y < 1 || o.x + x > innerWidth - 2 || o.y + y > innerHeight - 2;
    if (out()) { el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' }); o = frameOrigin(el); }
    if (out()) { scrollBy({ left: o.x + x - innerWidth / 2, top: o.y + y - innerHeight / 2, behavior: 'instant' }); o = frameOrigin(el); }
    if (out()) throw new Error('That part of the embedded frame could not be scrolled into view.');
    const hit = deepPoint(o.x + x, o.y + y);
    if (hit !== el) throw new Error(`The embedded frame is covered by <${hit?.tagName.toLowerCase()}> there.`);
    return { x: o.x + x, y: o.y + y };
  }
  /** The child's own coordinates for a point in this document, or null when the point is elsewhere. */
  async function pointInChild(nonce, x, y) {
    const el = await childElement(nonce);
    if (deepPoint(x, y) !== el) return null;
    const o = frameOrigin(el);
    return { x: x - o.x, y: y - o.y };
  }
  const childFocused = async (nonce) => (await childElement(nonce)) === active();

  function fileInput(ref) {
    const el = find(ref);
    if (el.tagName !== 'INPUT' || el.type !== 'file') return { file: false };
    if (el.disabled) throw new Error('That file input is disabled.');
    return { file: true, multiple: el.multiple };
  }
  function setFiles(ref, list) {
    const el = find(ref);
    const dt = new DataTransfer();
    for (const f of list) dt.items.add(new File([Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))], f.name, { type: f.type }));
    el.files = dt.files;
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.files.length;
  }

  function dropFiles(x, y, list) {
    const el = deepPoint(x, y);
    if (!el) throw new Error('There is nothing at that point.');
    const dt = new DataTransfer();
    for (const f of list) dt.items.add(new File([Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))], f.name, { type: f.type }));
    const fire = (type) => !el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, dataTransfer: dt }));
    fire('dragenter');
    fire('dragover');
    return fire('drop'); // true when the page handled it
  }

  // ---- find: matches the words of a description against what elements are called
  const STOP = new Set(['the', 'a', 'an', 'to', 'for', 'of', 'in', 'on', 'that', 'this', 'with', 'and', 'or', 'my', 'me', 'page', 'element']);
  const SAME = [['search', 'find', 'query'], ['login', 'signin', 'sign', 'log'], ['logout', 'signout'], ['register', 'signup', 'join'], ['cart', 'basket', 'bag'],
    ['submit', 'send', 'apply', 'continue', 'save', 'confirm'], ['close', 'dismiss', 'cancel'], ['email', 'mail', 'e-mail'], ['phone', 'telephone', 'mobile', 'tel'],
    ['upload', 'attach', 'file', 'browse'], ['menu', 'navigation', 'hamburger'], ['next', 'forward'], ['previous', 'back', 'prev'], ['delete', 'remove', 'trash'], ['settings', 'preferences', 'options'], ['cv', 'resume']];
  const KIND = { button: ['button'], link: ['link'], box: ['textbox', 'searchbox', 'combobox'], field: ['textbox', 'searchbox', 'combobox', 'spinbutton'], input: ['textbox', 'searchbox', 'file input'], bar: ['textbox', 'searchbox'], dropdown: ['combobox'], select: ['combobox'], checkbox: ['checkbox'], radio: ['radio'], tab: ['tab'], heading: ['heading1', 'heading2', 'heading3', 'heading4'], image: ['image'] };
  const words = (s) => (s || '').toLowerCase().replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  function search(query) {
    const q = words(query).filter((w) => !STOP.has(w));
    if (!q.length) throw new Error('Describe what to look for.');
    const results = [];
    const visit = (root) => {
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) visit(el.shadowRoot);
        if (SKIP.has(el.tagName)) continue;
        const file = el.tagName === 'INPUT' && el.type === 'file';
        const role = file ? 'file input' : roleOf(el);
        if (!file && !isInteractive(el, role) && !/^heading/.test(role)) continue;
        if (!file && !visible(el)) continue;
        const field = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
        const name = squash(nameOf(el) || (field ? '' : el.innerText)).slice(0, 160);
        const named = new Set(words(name));
        const attrs = new Set(words([el.id, el.getAttribute('name'), el.tagName === 'BUTTON' ? '' : el.type, el.getAttribute('placeholder'), el.title, el.getAttribute('data-testid'), typeof el.className === 'string' ? el.className : ''].join(' ')));
        let score = name.toLowerCase().includes(query.trim().toLowerCase()) ? 6 : 0;
        let content = score > 0;
        for (const w of q) {
          if (KIND[w]?.includes(role)) { score += 2; if (q.length === 1) content = true; } else if (named.has(w)) { score += 4; content = true; } else if (attrs.has(w)) { score += 2; content = true; } else {
            const alike = SAME.find((g) => g.includes(w));
            if (alike?.some((v) => named.has(v))) { score += 2; content = true; } else if (alike?.some((v) => attrs.has(v))) { score += 1; content = true; } else if (w.length > 3 && [...named].some((v) => v.startsWith(w) || (v.length > 3 && w.startsWith(v)))) { score += 2; content = true; }
          }
        }
        if (!content) continue;
        score -= Math.min(named.size, 20) * 0.1; // prefer short, specific names
        results.push({ score, line: file ? fileLine(el) : `${role || 'clickable'} ${JSON.stringify(name)} [ref=${refFor(el)}]` });
      }
    };
    visit(document);
    results.sort((a, b) => b.score - a.score);
    return { prefix, results: results.slice(0, 12) };
  }

  // ---- on-page indicator. Lives in a closed shadow root, ignores the mouse, and hides for screenshots.
  let mark = null;
  let timer = 0;
  function indicate(x, y) {
    if (!mark?.host.isConnected) {
      const host = document.createElement('div');
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647';
      const root = host.attachShadow({ mode: 'closed' });
      const frame = document.createElement('div');
      frame.style.cssText = 'position:fixed;inset:0;padding:3px;background:linear-gradient(135deg,#4f7cff,#8b5cf6);-webkit-mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0);mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0);pointer-events:none';
      const glow = document.createElement('div');
      glow.style.cssText = 'position:fixed;inset:0;box-shadow:inset 0 0 40px #4f7cff66;pointer-events:none';
      const pill = document.createElement('div');
      pill.textContent = 'An agent is using this tab';
      pill.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:#141416d9;color:#fff;font:600 13px/1.2 system-ui,sans-serif;padding:10px 18px;border-radius:999px;border:1px solid #ffffff38;box-shadow:0 8px 32px #4f7cff66;backdrop-filter:blur(14px);pointer-events:none';
      const dot = document.createElement('div');
      dot.style.cssText = 'position:fixed;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:#4f7cff55;border:2px solid #4f7cff;box-shadow:0 0 18px #8b5cf6;box-sizing:border-box;pointer-events:none;display:none';
      root.append(glow, frame, pill, dot);
      document.documentElement.append(host);
      mark = { host, dot };
    }
    mark.host.style.display = '';
    if (typeof x === 'number') { mark.dot.style.display = ''; mark.dot.style.left = `${x}px`; mark.dot.style.top = `${y}px`; }
    clearTimeout(timer);
    timer = setTimeout(() => { mark?.host.remove(); mark = null; }, 5000);
  }
  const hideIndicator = () => { if (mark) mark.host.style.display = 'none'; };

  // Whether a real press has reached this document since the last arm().
  let pressed = null; // null until armed, so a page reached by the click itself never warns
  for (const t of ['pointerdown', 'mousedown']) addEventListener(t, (e) => { if (e.isTrusted && pressed === false) pressed = true; }, { capture: true, passive: true });

  return {
    present: (ref) => !!byRef.get(ref)?.deref()?.isConnected,
    arm: () => { pressed = false; },
    wasPressed: () => pressed,
    expectChild, callParent, childPoint, pointInChild, childFocused, fileInput, setFiles,
    dropFiles, search, indicate, hideIndicator,
    read, text, locate, focusInfo, selectAll, setValue,
    hasText: (t) => (document.body?.innerText || '').includes(t),
    pointInfo: (x, y) => { const el = deepPoint(x, y); return { frame: isFrame(el) }; },
    viewport: () => ({ w: innerWidth, h: innerHeight, sx: scrollX, sy: scrollY }),
  };
})();
