import * as cheerio from 'cheerio';
import type { TMWebDriver } from './TMWebDriver.js';

type $API = ReturnType<typeof cheerio.load>;

// =============================================================================
// Browser-injected JavaScript strings
// =============================================================================

/** DOM 简化 + 可见性分析 —— 在浏览器中执行，返回 root.outerHTML */
const JS_OPT_HTML = `function optHTML(text_only=false) {
function createEnhancedDOMCopy() {
  const nodeInfo = new WeakMap();
  const ignoreTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK', 'COLGROUP', 'COL', 'TEMPLATE', 'PARAM', 'SOURCE'];
  const ignoreIds = ['ljq-ind'];
  function cloneNode(sourceNode, keep=false) {
    if (sourceNode.nodeType === 8 ||
        (sourceNode.nodeType === 1 && (
          ignoreTags.includes(sourceNode.tagName) ||
          (sourceNode.id && ignoreIds.includes(sourceNode.id))
        ))) { return null; }
    if (sourceNode.nodeType === 3) return sourceNode.cloneNode(false);
    const clone = sourceNode.cloneNode(false);
    if ((sourceNode.tagName === 'INPUT' || sourceNode.tagName === 'TEXTAREA') && sourceNode.value) clone.setAttribute('value', sourceNode.value);
    if (sourceNode.tagName === 'INPUT' && (sourceNode.type === 'radio' || sourceNode.type === 'checkbox') && sourceNode.checked) clone.setAttribute('checked', '');
    else if (sourceNode.tagName === 'SELECT' && sourceNode.value) clone.setAttribute('data-selected', sourceNode.value);
    try { if (sourceNode.matches && sourceNode.matches(':-webkit-autofill')) { clone.setAttribute('data-autofilled', 'true'); if (!sourceNode.value) clone.setAttribute('value', '⚠️受保护-读tmwebdriver_sop的autofill章节提取'); } } catch(e) {}
    const isDropdown = sourceNode.classList?.contains('dropdown-menu') ||
             /dropdown|menu/i.test(sourceNode.className) || sourceNode.getAttribute('role') === 'menu';
    const _ddItems = isDropdown ? sourceNode.querySelectorAll('a, button, [role="menuitem"], li').length : 0;
    const isSmallDropdown = _ddItems > 0 && _ddItems <= 7 && sourceNode.textContent.length < 500;
    const childNodes = [];
    for (const child of sourceNode.childNodes) {
      const childClone = cloneNode(child, keep || isSmallDropdown);
      if (childClone) childNodes.push(childClone);
    }
    if (sourceNode.tagName === 'IFRAME') {
      try {
        const iDoc = sourceNode.contentDocument || sourceNode.contentWindow?.document;
        if (iDoc && iDoc.body && iDoc.body.children.length > 0) {
          const wrapper = document.createElement('div');
          wrapper.setAttribute('data-iframe-content', sourceNode.src || '');
          for (const ch of iDoc.body.childNodes) { const c = cloneNode(ch, keep); if (c) wrapper.appendChild(c); }
          if (wrapper.childNodes.length) childNodes.push(wrapper);
        }
      } catch(e) {}
    }
    if (sourceNode.shadowRoot) {
      for (const shadowChild of sourceNode.shadowRoot.childNodes) {
        const shadowClone = cloneNode(shadowChild, keep);
        if (shadowClone) childNodes.push(shadowClone);
      }
    }
    const rect = sourceNode.getBoundingClientRect();
    const style = window.getComputedStyle(sourceNode);
    const area = (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) <= 0)?0:rect.width * rect.height;
    const isVisible = (rect.width > 1 && rect.height > 1 &&
                  style.display !== 'none' && style.visibility !== 'hidden' &&
                  parseFloat(style.opacity) > 0 &&
                  Math.abs(rect.left) < 5000 && Math.abs(rect.top) < 5000)
                  || isSmallDropdown;
    const zIndex = style.position !== 'static' ? (parseInt(style.zIndex) || 0) : 0;
    let info = { rect, area, isVisible, isSmallDropdown, zIndex,
          style: { display: style.display, visibility: style.visibility, opacity: style.opacity, position: style.position }};
    const nonTextChildren = childNodes.filter(child => child.nodeType !== 3);
    const hasValidChildren = nonTextChildren.length > 0;
    if (hasValidChildren) {
      const childrenInfos = nonTextChildren.map(c => nodeInfo.get(c)).filter(i => i && i.rect && i.rect.width > 0 && i.rect.height > 0);
      const bgAlpha = (() => {
        const c = style.backgroundColor;
        if (!c || c === 'transparent') return 0;
        const m = c.match(/rgba?\\([^)]+,\\s*([\\d.]+)\\)/);
        return m ? parseFloat(m[1]) : 1;
      })();
      const hasVisualBg = bgAlpha > 0.1 || style.backgroundImage !== 'none' || (style.backdropFilter && style.backdropFilter !== 'none') || style.boxShadow !== 'none';
      if (!hasVisualBg && childrenInfos.length > 0) {
        let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
        for (const cInfo of childrenInfos) { minL = Math.min(minL, cInfo.rect.left); minT = Math.min(minT, cInfo.rect.top); maxR = Math.max(maxR, cInfo.rect.right); maxB = Math.max(maxB, cInfo.rect.bottom); }
        info.rect = { left: minL, top: minT, right: maxR, bottom: maxB, width: maxR - minL, height: maxB - minT };
        info.area = info.rect.width * info.rect.height;
      } else {
        const maxC = childrenInfos.filter(i => i.isVisible).sort((a, b) => b.area - a.area)[0];
        if (maxC && maxC.area > 10000 && (!isVisible || maxC.area > info.area * 5)) info = maxC;
      }
    }
    nodeInfo.set(clone, info);
    if (sourceNode.nodeType === 1 && sourceNode.tagName === 'DIV') {
      if (!hasValidChildren && !sourceNode.textContent.trim()) return null;
    }
    if (sourceNode.getAttribute && sourceNode.getAttribute('aria-hidden') === 'true' && !info.isVisible) return null;
    if (info.isVisible || hasValidChildren || keep) { childNodes.forEach(child => clone.appendChild(child)); return clone; }
    return null;
  }
  return { domCopy: cloneNode(document.body), getNodeInfo: node => nodeInfo.get(node), isVisible: node => { const info = nodeInfo.get(node); return info && info.isVisible; } };
}
const { domCopy, getNodeInfo, isVisible } = createEnhancedDOMCopy();
if (text_only) {
  const blocks = new Set(['DIV','P','H1','H2','H3','H4','H5','H6','LI','TR','SECTION','ARTICLE','HEADER','FOOTER','NAV','BLOCKQUOTE','PRE','HR','BR','DT','DD','FIGCAPTION','DETAILS','SUMMARY']);
  domCopy.querySelectorAll('*').forEach(el => { if (blocks.has(el.tagName)) el.insertAdjacentText('beforebegin', '\\n'); });
  domCopy.querySelectorAll('input:not([type=hidden]),textarea,select').forEach(el=>{
    const p=[el.tagName,el.id&&'#'+el.id,el.getAttribute('name')&&'name='+el.getAttribute('name'),el.tagName==='INPUT'&&'type='+(el.getAttribute('type')||'text'),el.getAttribute('placeholder')&&'"'+el.getAttribute('placeholder')+'"',el.getAttribute('data-autofilled')&&'autofilled',el.disabled&&'disabled',el.tagName==='SELECT'&&el.getAttribute('data-selected')&&'="'+el.getAttribute('data-selected')+'"'].filter(Boolean).join(' ');
    el.insertAdjacentText('beforebegin','\\n['+p+']\\n');
  });
  domCopy.querySelectorAll('button[disabled]').forEach(el=>el.insertAdjacentText('beforebegin','[DISABLED] '));
  return domCopy.textContent;
}
const viewportArea = window.innerWidth * window.innerHeight;
function analyzeNode(node, pPathType='main') {
    if (node.nodeType !== 1 || !node.children.length) { node.nodeType === 1 && (node.dataset.mark = 'K:leaf'); return; }
    const pathType = (node.dataset.mark === 'K:secondary') ? 'second' : pPathType;
    const nodeInfoData = getNodeInfo(node);
    if (!nodeInfoData || !nodeInfoData.rect) return;
    const rectn = nodeInfoData.rect;
    if (rectn.width < window.innerWidth * 0.8 && rectn.height < window.innerHeight * 0.8) return node;
    if (node.tagName === 'TABLE') return;
    const children = Array.from(node.children);
    if (children.length === 1) { node.dataset.mark = 'K:container'; return analyzeNode(children[0], pathType); }
    if (children.length > 10) return;
    const childrenInfo = children.map(child => { const info = getNodeInfo(child) || { rect: {}, style: {} }; return { node: child, rect: info.rect, style: info.style, area: info.area, zIndex: (info.zIndex || 0), isVisible: info.isVisible }; });
    childrenInfo.sort((a, b) => b.area - a.area);
    const isOverlay = hasOverlap(childrenInfo);
    node.dataset.mark = isOverlay ? 'K:overlayParent' : 'K:partitionParent';
    if (isOverlay) handleOverlayContainer(childrenInfo, pathType);
    else handlePartitionContainer(childrenInfo, pathType);
    for (const child of children) if (!child.dataset.mark || child.dataset.mark[0] !== 'R') analyzeNode(child, pathType);
  }
  function handlePartitionContainer(childrenInfo, pathType) {
    childrenInfo.sort((a, b) => b.area - a.area);
    const totalArea = childrenInfo.reduce((sum, item) => sum + item.area, 0);
    const hasMainElement = childrenInfo.length >= 1 && (childrenInfo[0].area / totalArea > 0.5) && (childrenInfo.length === 1 || childrenInfo[0].area > childrenInfo[1].area * 2);
    if (hasMainElement) {
      childrenInfo[0].node.dataset.mark = 'K:main';
      for (let i = 1; i < childrenInfo.length; i++) {
        const child = childrenInfo[i];
        let className = (child.node.getAttribute('class') || '').toLowerCase();
        let isSecondary = containsButton(child.node);
        if (className.includes('nav')) isSecondary = true;
        if (className.includes('breadcrumbs')) isSecondary = true;
        if (className.includes('header') && className.includes('table')) isSecondary = true;
        if (child.node.innerHTML.trim().replace(/\\s+/g, '').length < 500) isSecondary = true;
        if (child.node.textContent.trim().length > 200) isSecondary = true;
        if (child.style.visibility === 'hidden') isSecondary = false;
        if (isSecondary) child.node.dataset.mark = 'K:secondary';
        else child.node.dataset.mark = 'K:nonEssential';
      }
    }
  }
  function containsButton(container) {
    const hasStandardButton = container.querySelector('button, input[type="button"], input[type="submit"], [role="button"]') !== null;
    if (hasStandardButton) return true;
    return container.querySelector('[class*="-btn"], [class*="-button"], .button, .btn, [class*="btn-"]') !== null;
  }
  function handleOverlayContainer(childrenInfo, pathType) {
    const _efp = document.elementFromPoint(window.innerWidth/2, window.innerHeight/2);
    if (_efp) { let _el = _efp; while (_el) { const _h = childrenInfo.find(c => c.node.id && c.node.id === _el.id); if (_h) { _h.zIndex = 9999; break; } _el = _el.parentElement; } }
    const sorted = [...childrenInfo].sort((a, b) => b.zIndex - a.zIndex);
    if (sorted.length === 0) return;
    const top = sorted[0]; const rect = top.rect; const topNode = top.node;
    const isComplex = top.node.querySelectorAll('input, select, textarea, button, a, [role="button"]').length >= 1;
    const textContent = topNode.textContent?.trim() || '';
    const textLength = textContent.length;
    const hasLinks = topNode.querySelectorAll('a').length > 0;
    const isMostlyText = textLength > 7 && !hasLinks;
    const centerDiff = Math.abs((rect.left + rect.width/2) - window.innerWidth/2) / window.innerWidth;
    const minDimensionRatio = Math.min(rect.width / window.innerWidth, rect.height / window.innerHeight);
    const maxDimensionRatio = Math.max(rect.width / window.innerWidth, rect.height / window.innerHeight);
    const isNearTop = rect.top < 50;
    const isDialog = (top.node.querySelector('iframe') || top.node.querySelector('button') || top.node.querySelector('input')) && centerDiff < 0.3;
    if (isComplex && centerDiff < 0.2 && ((minDimensionRatio > 0.2 && rect.width/window.innerWidth < 0.98) || minDimensionRatio > 0.95)) {
      top.node.dataset.mark = 'K:mainInteractive';
      sorted.slice(1).forEach(e => { if ((parseInt(e.zIndex)||0) <= (parseInt(sorted[0].zIndex)||0)) { e.node.dataset.mark = 'R:covered'; } else { e.node.dataset.mark = 'K:noncovered'; } });
    } else {
      if (isComplex && isNearTop && maxDimensionRatio > 0.4 && top.isVisible) { top.node.dataset.mark = 'K:topBar'; }
      else if (isMostlyText || isComplex || isDialog) { topNode.dataset.mark = 'K:messageContent'; }
      else { topNode.dataset.mark = 'R:floatingAd'; }
      const rest = sorted.slice(1);
      rest.length && (!hasOverlap(rest) ? handlePartitionContainer(rest, pathType) : handleOverlayContainer(rest, pathType));
    }
  }
  function hasOverlap(items) {
    return items.some((a, i) => items.slice(i+1).some(b => {
        const r1 = a.rect, r2 = b.rect;
        if (!r1.width || !r2.width || !r1.height || !r2.height) return false;
        const epsilon = 1;
        const x1 = r1.x !== undefined ? r1.x : r1.left; const y1 = r1.y !== undefined ? r1.y : r1.top;
        const x2 = r2.x !== undefined ? r2.x : r2.left; const y2 = r2.y !== undefined ? r2.y : r2.top;
        return !(x1 + r1.width <= x2 + epsilon || x1 >= x2 + r2.width - epsilon || y1 + r1.height <= y2 + epsilon || y1 >= y2 + r2.height - epsilon);
      }));
  }
const _fc = [...domCopy.querySelectorAll('*')].filter(el => {
  if (el.parentNode === domCopy) return false;
  const info = getNodeInfo(el);
  if (!info?.rect || info.style.position !== 'fixed') return false;
  const r = info.rect, cover = (r.width * r.height) / viewportArea;
  const cd = Math.abs((r.left + r.width/2) - window.innerWidth/2) / window.innerWidth;
  return cover > 0.15 && cover < 1.0 && cd < 0.3 && el.querySelector('button, input, a, [role="button"], iframe');
}).filter((el, _, arr) => !arr.some(o => o !== el && o.contains(el)))
  .sort((a, b) => (getNodeInfo(b).rect.width * getNodeInfo(b).rect.height) - (getNodeInfo(a).rect.width * getNodeInfo(a).rect.height))
  .slice(0, 2);
_fc.forEach(el => { el.parentNode.removeChild(el); domCopy.appendChild(el); });
analyzeNode(domCopy);
domCopy.querySelectorAll('[data-mark^="R:"]').forEach(el=>el.parentNode?.removeChild(el));
let root = domCopy;
while (root.children.length === 1) { root = root.children[0]; }
for (let ii = 0; ii < 3; ii++) {
  root.querySelectorAll('div').forEach(div => (!div.textContent.trim() && div.children.length === 0) && div.remove());
}
root.querySelectorAll('[data-mark]').forEach(e => e.removeAttribute('data-mark'));
root.removeAttribute('data-mark');
root.querySelectorAll('iframe').forEach(f => {
  if (f.children.length) {
    const d = document.createElement('div');
    for (const a of f.attributes) d.setAttribute(a.name, a.value);
    d.setAttribute('data-tag', 'iframe');
    while (f.firstChild) d.appendChild(f.firstChild);
    f.parentNode.replaceChild(d, f);
  }
});
return root.outerHTML;
}`;

/** 主列表检测 —— 在浏览器中执行 */
const JS_FIND_MAIN_LIST = `function findMainList(startElement = null) {
        const root = startElement || document.body;
        const MIN_CHILDREN = 8; const MAX_CONTAINERS = 20;
        const candidates = [];
        const allEls = root.querySelectorAll('*');
        for (const node of allEls) {
            if (node.closest('svg')) continue;
            const l1 = node.children.length; if (l1 < 5) continue;
            let l2 = 0; for (const child of node.children) l2 += child.children.length;
            const score = l1 + l2 * 0.1;
            if (score >= MIN_CHILDREN) candidates.push({node, score});
        }
        candidates.sort((a, b) => b.score - a.score);
        const toProcess = candidates.slice(0, MAX_CONTAINERS).map(c => c.node);
        let allCandidates = [];
        for (const container of toProcess) {
            const topGroups = findTopGroups(container, 3);
            for (const groupInfo of topGroups) {
                const items = findMatchingElements(container, groupInfo.selector);
                if (items.length >= 5) {
                    const score = scoreContainer(container, items) + groupInfo.score;
                    if (score >= 30) allCandidates.push({ container, selector: groupInfo.selector, items, score });
                }
            }
        }
        allCandidates.sort((a, b) => b.score - a.score);
        const kept = [];
        for (const cand of allCandidates) {
            let dominated = false;
            for (const k of kept) {
                if (k.container.contains(cand.container) || cand.container.contains(k.container)) {
                    const kSet = new Set(k.items); const overlap = cand.items.filter(it => kSet.has(it)).length;
                    if (overlap > cand.items.length * 0.5) { dominated = true; break; }
                }
            }
            if (!dominated) kept.push(cand);
        }
        function describeResult(container, items, selector, score) {
            if(container&&!container.id)container.id='_ljq'+(window._lci=(window._lci||0)+1);
            const cTag = container ? container.tagName : null;
            const cId = container ? (container.id || '') : '';
            const cClass = container ? (String(container.className || '').trim()) : '';
            const result = { containerTag: cTag, containerId: cId, containerClass: cClass, itemCount: items.length };
            let prefix = ''; if (cId) prefix = '#' + CSS.escape(cId);
            if (selector) result.selector = prefix ? (prefix + ' > ' + selector) : selector;
            if (score !== undefined) result.score = score;
            if (items.length > 0) {
                result.firstItemPreview = items[0].outerHTML.substring(0, 200);
                result.itemTags = items.slice(0, 10).map(el => el.tagName + (el.className ? '.' + String(el.className).trim().split(/\\s+/)[0] : ''));
            }
            return result;
        }
        if (kept.length === 0) return [];
        return kept.map(c => describeResult(c.container, c.items, c.selector, c.score));
    }
    function findTopGroups(container, limit) {
        const children = Array.from(container.children).filter(c => !c.closest('svg'));
        const totalChildren = children.length; if (totalChildren < 3) return [];
        const minGroupSize = Math.max(3, Math.floor(totalChildren * 0.2));
        const groups = []; const tagFreq = {}, classFreq = {}, tagMap = {}, classMap = {};
        children.forEach(child => {
            const tag = child.tagName.toLowerCase(); if (tag === "td") return;
            tagFreq[tag] = (tagFreq[tag] || 0) + 1; if (!tagMap[tag]) tagMap[tag] = []; tagMap[tag].push(child);
            if (child.className) { child.className.trim().split(/\\s+/).forEach(cls => { if (cls) { classFreq[cls] = (classFreq[cls] || 0) + 1; if (!classMap[cls]) classMap[cls] = []; classMap[cls].push(child); } }); }
        });
        const scoreGroup = (selector, elements) => { const coverage = elements.length / totalChildren; let specificity = selector.startsWith('.') ? (0.6 + (selector.match(/\\./g).length - 1) * 0.1) : (selector.includes('.') ? (0.7 + (selector.match(/\\./g).length) * 0.1) : 0.3); return (coverage * 0.5) + (specificity * 0.5); };
        Object.keys(tagFreq).forEach(tag => { if (tag !== "div" && tagFreq[tag] >= minGroupSize) groups.push({ selector: tag, elements: tagMap[tag], score: scoreGroup(tag, tagMap[tag]) - 0.5 }); });
        Object.keys(classFreq).forEach(cls => { if (classFreq[cls] >= minGroupSize) { const selector = '.' + CSS.escape(cls); groups.push({ selector, elements: classMap[cls], score: scoreGroup(selector, classMap[cls]) }); } });
        const topTags = Object.keys(tagFreq).filter(t => tagFreq[t] >= minGroupSize).slice(0, 3);
        const topClasses = Object.keys(classFreq).filter(c => classFreq[c] >= minGroupSize).sort((a, b) => classFreq[b] - classFreq[a]).slice(0, 3);
        topTags.forEach(tag => { topClasses.forEach(cls => { const elements = children.filter(el => el.tagName.toLowerCase() === tag && el.className && el.className.split(/\\s+/).includes(cls)); if (elements.length >= minGroupSize) { const selector = tag + '.' + CSS.escape(cls); groups.push({selector, elements, score: scoreGroup(selector, elements)}); } }); });
        for (let i = 0; i < topClasses.length; i++) { for (let j = i + 1; j < topClasses.length; j++) { const elements = children.filter(el => el.className && el.className.split(/\\s+/).includes(topClasses[i]) && el.className.split(/\\s+/).includes(topClasses[j])); if (elements.length >= minGroupSize) { const selector = '.' + CSS.escape(topClasses[i]) + '.' + CSS.escape(topClasses[j]); groups.push({selector, elements, score: scoreGroup(selector, elements)}); } } }
        return groups.sort((a, b) => b.score - a.score).slice(0, limit);
    }
    function findMatchingElements(container, selector) { try { return Array.from(container.querySelectorAll(selector)); } catch (e) { return []; } }
    function scoreContainer(container, items) {
        if (!container || items.length < 3) return 0;
        const containerRect = container.getBoundingClientRect(); const containerArea = containerRect.width * containerRect.height;
        if (containerArea < 10000) return 0;
        const itemAreas = []; let totalItemArea = 0; let visibleItems = 0;
        items.forEach(item => { const rect = item.getBoundingClientRect(); const area = rect.width * rect.height; if (area > 0) { totalItemArea += area; itemAreas.push(area); visibleItems++; } });
        if (visibleItems < 3) return 0;
        totalItemArea = Math.min(totalItemArea, containerArea * 0.98);
        const areaRatio = totalItemArea / containerArea;
        const areaScore = 40 / (1 + Math.exp(-12 * (areaRatio - 0.4)));
        let uniformityScore = 0;
        if (itemAreas.length >= 3) { const mean = itemAreas.reduce((sum, area) => sum + area, 0) / itemAreas.length; const variance = itemAreas.reduce((sum, area) => sum + Math.pow(area - mean, 2), 0) / itemAreas.length; const cv = mean > 0 ? Math.sqrt(variance) / mean : 1; uniformityScore = 20 * Math.exp(-2.5 * cv); }
        const baseScore = Math.log2(visibleItems) * 5 + Math.floor(visibleItems / 5) * 0.25;
        const countScore = Math.min(40, baseScore) * Math.max(0.1, uniformityScore / 20);
        const viewportArea = window.innerWidth * window.innerHeight;
        const sizeScore = 2 * (1 - 1/(1 + Math.exp(-10 * (containerArea / viewportArea - 0.25))));
        let layoutScore = 0;
        if (items.length >= 3) {
            const uniqueRows = new Set(items.map(item => Math.round(item.getBoundingClientRect().top / 5) * 5)).size;
            const uniqueCols = new Set(items.map(item => Math.round(item.getBoundingClientRect().left / 5) * 5)).size;
            if (uniqueRows === 1 || uniqueCols === 1) { layoutScore = 20; }
            else { const coverage = Math.min(1, items.length / (uniqueRows * uniqueCols)); const efficiency = Math.max(0, 1 - (uniqueRows + uniqueCols) / (2 * items.length)); layoutScore = 20 * (0.7 * coverage + 0.3 * efficiency); }
        }
        return countScore + areaScore + uniformityScore + layoutScore + sizeScore;
    }`;

/** 瞬态文字监控 —— 注入后立即开始采集 */
const TEMP_MONITOR_JS = `function startStrMonitor(interval) {
  if (window._tm && window._tm.id) clearInterval(window._tm.id);
  window._tm = {extract: () => {
    const texts = new Set(), walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node, t, s; while (node = walker.nextNode())
      ((t = node.textContent.trim()) && t.length > 10 && !(s = t.substring(0, 20)).includes('_')) && texts.add(s);
    return texts;
  }};
  window._tm.init = window._tm.extract();
  window._tm.all = new Set();
  window._tm.id = setInterval(() => window._tm.extract().forEach(t => window._tm.all.add(t)), interval);
}
startStrMonitor(450);`;

// =============================================================================
// 允许保留的 HTML 属性白名单
// =============================================================================

const ALLOWED_ATTRS = new Set([
  'id', 'class', 'name', 'src', 'href', 'alt', 'value', 'type', 'placeholder',
  'disabled', 'checked', 'selected', 'readonly', 'required', 'multiple',
  'role', 'aria-label', 'aria-expanded', 'aria-hidden', 'contenteditable',
  'title', 'for', 'action', 'method', 'target', 'colspan', 'rowspan',
]);

// =============================================================================
// HTML 处理工具
// =============================================================================

/**
 * 对应 Python 的 optimize_html_for_tokens。
 * 清理 HTML：去除冗余属性、截断长值、压缩 SVG。
 * 修改传入的 $API 对象（in-place），并返回它。
 */
function optimizeHtmlForTokens($: $API): $API {
  // 清空 SVG
  $('svg').each((_, el) => {
    $(el).empty();
    (el as any).attribs = {};
  });
  // 移除所有 style 属性
  $('*').removeAttr('style');

  $('*').each((_, el) => {
    const attribs: Record<string, string> = (el as any).attribs ?? {};

    // src
    if ('src' in attribs) {
      if (attribs.src.startsWith('data:')) attribs.src = '__img__';
      else if (attribs.src.length > 30) attribs.src = '__url__';
    }
    // href
    if ('href' in attribs && attribs.href.length > 30) attribs.href = '__link__';
    // action
    if ('action' in attribs && attribs.action.length > 30) attribs.action = '__url__';
    // value / title / alt 截断
    for (const a of ['value', 'title', 'alt'] as const) {
      if (a in attribs && attribs[a].length > 100) attribs[a] = attribs[a].slice(0, 50) + ' ...';
    }

    // 清理不在白名单中的属性
    const toRemove: string[] = [];
    for (const attr of Object.keys(attribs)) {
      if (ALLOWED_ATTRS.has(attr)) continue;
      if (attr.startsWith('data-v')) {
        toRemove.push(attr);
      } else if (attr.startsWith('data-') && attribs[attr].length > 20) {
        attribs[attr] = '__data__';
      } else if (!attr.startsWith('data-')) {
        toRemove.push(attr);
      }
    }
    for (const attr of toRemove) delete attribs[attr];
  });

  return $;
}

/**
 * 对应 Python 的 get_main_block。
 * 在浏览器中执行 optHTML JS，返回简化后的页面 HTML（或纯文本）。
 */
async function getMainBlock(
  driver: TMWebDriver,
  extraJs = '',
  textOnly = false,
): Promise<string> {
  const code = `${extraJs}\n${JS_OPT_HTML}\nreturn optHTML(${textOnly});`;
  const resp = await driver.executeJs(code, { timeout: 30 });
  let page: string = resp?.data ?? '';

  if (textOnly) {
    page = page.replace(/ {2,}/g, ' ').replace(/^ +/gm, '').replace(/(\n\s*){3,}/g, '\n\n').trim();
  }
  return page;
}

/**
 * 对应 Python 的 find_changed_elements。
 * 比较两段 HTML，返回变化数量和最显著变化块。
 */
export function findChangedElements(
  beforeHtml: string,
  afterHtml: string,
): Record<string, any> {
  const $before = cheerio.load(beforeHtml);
  const $after = cheerio.load(afterHtml);

  function directText($: $API, el: any): string {
    return $(el)
      .contents()
      .filter((_, node) => (node as any).type === 'text')
      .map((_, node) => $(node as any).text().trim())
      .get()
      .join('')
      .trim();
  }

  function getSig($: $API, el: any): string {
    const attrs = { ...(el.attribs ?? {}) };
    delete attrs['data-track-id'];
    return `${el.tagName}:${JSON.stringify(attrs)}:${directText($, el)}`;
  }

  function buildSigs($: $API): Map<string, any[]> {
    const result = new Map<string, any[]>();
    $('*').each((_, el) => {
      const sig = getSig($, el);
      if (!result.has(sig)) result.set(sig, []);
      result.get(sig)!.push(el);
    });
    return result;
  }

  const beforeSigs = buildSigs($before);
  const afterSigs = buildSigs($after);

  const changed: any[] = [];
  for (const [sig, els] of afterSigs) {
    const prev = beforeSigs.get(sig);
    if (!prev) {
      changed.push(...els);
    } else if (els.length > prev.length) {
      changed.push(...els.slice(0, els.length - prev.length));
    }
  }

  if (changed.length === 0 && $before.html() !== $after.html()) {
    const beforeEls = $before('*').toArray();
    const afterEls = $after('*').toArray();
    for (let i = 0; i < Math.min(beforeEls.length, afterEls.length); i++) {
      if (getSig($before, beforeEls[i]) !== getSig($after, afterEls[i])) {
        changed.push(afterEls[i]);
      }
    }
  }

  const changedSet = new WeakSet<object>(changed);
  const boundaries = changed.filter((el) => {
    const parent = el.parent;
    return !parent || !changedSet.has(parent);
  });

  const top =
    boundaries.length > 0
      ? boundaries.reduce((a: any, b: any) =>
          ($after.html(a) ?? '').length >= ($after.html(b) ?? '').length ? a : b,
        )
      : null;

  const result: Record<string, any> = { changed: changed.length };
  if (top) {
    const h = $after.html(top) ?? '';
    result['top_change'] = h.length <= 2000 ? h : h.slice(0, 2000) + '...[TRUNCATED]';
  }
  return result;
}

// =============================================================================
// 瞬态文字监控
// =============================================================================

/** 对应 Python 的 start_temp_monitor */
export async function startTempMonitor(driver: TMWebDriver): Promise<void> {
  try {
    await driver.executeJs(TEMP_MONITOR_JS, { timeout: 5 });
  } catch {
    // 忽略，监控是可选的
  }
}

/** 对应 Python 的 get_temp_texts */
export async function getTempTexts(driver: TMWebDriver): Promise<string[]> {
  const js = `function stopStrMonitor() {
    if (!window._tm) return [];
    clearInterval(window._tm.id);
    const final = window._tm.extract();
    const newlySeen = [...window._tm.all].filter(t => !window._tm.init.has(t));
    let result;
    if (newlySeen.length < 8) { result = newlySeen; }
    else { result = newlySeen.filter(t => !final.has(t)); }
    delete window._tm;
    return result;
  }
  stopStrMonitor();`;
  try {
    const resp = await driver.executeJs(js, { timeout: 5 });
    const data = resp?.data ?? [];
    return [...new Set<string>(Array.isArray(data) ? data : [])];
  } catch {
    return [];
  }
}

// =============================================================================
// Smart Truncate（对应 Python 的 smart_truncate）
// =============================================================================

/**
 * 截断单个元素到 keep 字节，保护 FAKE ELEMENT 提示标签。
 * 对应 Python 的 smart_truncate 内部 cut() 函数。
 */
function cutElement($: $API, el: any, keep: number): void {
  const s = $.html(el) ?? '';
  const over = s.length - keep;
  if (over <= 0) return;

  // 保护 FAKE ELEMENT 标签
  const protected_: any[] = [];
  $(el)
    .find('*')
    .filter((_, c) => $(c).children().length === 0 && $(c).text().includes('[FAKE ELEMENT]'))
    .each((_, c) => {
      protected_.push($(c).clone());
      $(c).remove();
    });

  const s2 = $.html(el) ?? '';
  const over2 = s2.length - keep;
  if (over2 <= 0) {
    protected_.forEach((p) => $(el).append(p));
    return;
  }

  const marker = ` [TRUNCATED ${Math.floor(over2 / 1000)}k chars]`;
  const inner = $(el).html() ?? '';
  const tagOverhead = s2.length - inner.length;
  const innerKeep = Math.max(keep - tagOverhead - marker.length, 0);

  $(el).empty();
  if (innerKeep > 0) {
    const truncated = cheerio.load(inner.slice(0, innerKeep));
    $(el).append(truncated('body').html() ?? '');
  }
  $(el).append(marker);
  protected_.forEach((p) => $(el).append(p));
}

/**
 * 对应 Python 的 smart_truncate。
 * 递归裁剪元素内容以满足 budget 字节限制，修改 $API in-place。
 */
function smartTruncate($: $API, el: any, budget: number, depth = 0): void {
  const CUT_THRESHOLD = 8000;
  const indent = '  '.repeat(depth);

  const total = ($.html(el) ?? '').length;
  if (total <= budget) return;

  // 直接子元素（仅元素节点，排除 FAKE ELEMENT 提示标签）
  const children = $(el)
    .children()
    .toArray()
    .filter((c) => !($(c).children().length === 0 && $(c).text().includes('[FAKE ELEMENT]')));

  if (!children.length) return;

  const kids: [any, number][] = children.map((c) => [c, ($.html(c) ?? '').length]);
  const selfLen = total - kids.reduce((s, [, l]) => s + l, 0);
  const remainingBudget = Math.max(budget - selfLen, 0);

  console.log(`${indent}[smart_truncate] <${el.tagName}> total=${total} budget=${budget} selfLen=${selfLen} kids=${kids.length}`);

  // 单子元素：穿透递归
  if (kids.length === 1) {
    console.log(`${indent}  -> single child, recurse into <${kids[0][0].tagName}>`);
    smartTruncate($, kids[0][0], remainingBudget, depth);
    return;
  }

  const totalKidsLen = kids.reduce((s, [, l]) => s + l, 0);
  const over = totalKidsLen - remainingBudget;
  if (over <= 0) return;

  const ranked = [...kids].sort((a, b) => b[1] - a[1]);
  const tops = ranked.slice(0, Math.min(3, ranked.length));
  const topTotal = tops.reduce((s, [, l]) => s + l, 0);

  if (topTotal < over) {
    // top3 扛不住：从尾部删子元素
    let removed = 0, removedCount = 0;
    const mutable = [...kids];
    while (mutable.length > 0 && removed < over) {
      const [c, l] = mutable.pop()!;
      $(c).remove();
      removed += l;
      removedCount++;
    }
    console.log(`${indent}  -> tail-cut: removed ${removedCount} children (${Math.floor(removed / 1000)}k chars)`);
    return;
  }

  // 按比例分担
  const maxSize = ranked[0][1];
  const filtered = tops.filter(([, l]) => l >= maxSize * 0.1);
  const finalTops = filtered.reduce((s, [, l]) => s + l, 0) >= over ? filtered : tops;
  const finalTopTotal = finalTops.reduce((s, [, l]) => s + l, 0);

  const actions: [any, number][] = finalTops.map(([c, l]) => {
    const share = Math.floor((over * l) / finalTopTotal);
    const newKeep = l - share;
    console.log(`${indent}  -> <${c.tagName}> ${l} -> ${newKeep} (share=${share})`);
    return [c, newKeep];
  });

  for (const [c, newKeep] of actions) {
    if (newKeep <= 0) {
      $(c).remove();
    } else if (newKeep > CUT_THRESHOLD) {
      smartTruncate($, c, newKeep, depth + 1);
    } else {
      cutElement($, c, newKeep);
    }
  }
}

// =============================================================================
// 主函数
// =============================================================================

export interface GetHtmlOptions {
  /** 是否启用列表截断（cutlist） */
  cutlist?: boolean;
  /** 最大字符数 */
  maxchars?: number;
  /** 高亮匹配文本（cutlist keep 优先保留含此文本的条目） */
  instruction?: string;
  /** 额外注入的 JS（在 optHTML 之前执行） */
  extraJs?: string;
  /** 是否只返回纯文本 */
  textOnly?: boolean;
}

/**
 * 对应 Python 的 get_html。
 * 获取当前页面的简化 HTML（或纯文本），可选列表截断和长度限制。
 */
export async function getHtml(
  driver: TMWebDriver,
  options: GetHtmlOptions = {},
): Promise<string> {
  const {
    cutlist = false,
    maxchars = 35000,
    instruction = '',
    extraJs = '',
    textOnly = false,
  } = options;

  // 若启用 cutlist，先检测主列表
  let listCandidates: any[] = [];
  if (cutlist) {
    try {
      const resp = await driver.executeJs(
        `${JS_FIND_MAIN_LIST}\nreturn findMainList(document.body);`,
        { timeout: 15 },
      );
      const data = resp?.data;
      listCandidates = Array.isArray(data) ? data : data ? [data] : [];
    } catch {
      listCandidates = [];
    }
  }

  // 获取简化 HTML
  const page = await getMainBlock(driver, extraJs, textOnly);
  if (textOnly) return page;

  // 解析并优化
  const $doc = cheerio.load(page);
  optimizeHtmlForTokens($doc);

  // 将 div[data-tag="iframe"] 还原为 iframe
  $doc('div[data-tag="iframe"]').each((_, el) => {
    const $el = $doc(el);
    const attrs = { ...(el as any).attribs };
    delete attrs['data-tag'];
    const attrsStr = Object.entries(attrs)
      .map(([k, v]) => `${k}="${String(v).replace(/"/g, '&quot;')}"`)
      .join(' ');
    $el.replaceWith(`<iframe ${attrsStr}>${$el.html() ?? ''}</iframe>`);
  });

  let html = $doc.html() ?? '';
  if (!cutlist || listCandidates.length === 0) {
    if (html.length > maxchars) {
      const bodyEl = $doc('body')[0];
      if (bodyEl) smartTruncate($doc, bodyEl, maxchars);
      html = $doc.html() ?? html;
    }
    return html;
  }

  // ── cutlist 处理 ─────────────────────────────────────────────────────────
  const lists = listCandidates.filter(
    (e): e is Record<string, any> => typeof e === 'object' && e?.selector,
  );
  console.log(
    `[cutlist] Found ${lists.length} list(s): ${lists.map((e) => e.selector ?? '?')}`,
  );

  for (const entry of lists) {
    const sel: string = entry.selector;
    let items: any[];
    try {
      items = $doc(sel).toArray();
    } catch {
      console.log(`[cutlist] skip invalid selector: ${sel}`);
      continue;
    }
    if (items.length < 5) continue;

    const totalLen = items.reduce((s, it) => s + ($doc.html(it)?.length ?? 0), 0);
    const avgLen = totalLen / items.length;
    console.log(
      `[cutlist]   '${sel}': ${items.length} items, avg ${avgLen.toFixed(0)} chars, ` +
        `total ${totalLen}, if keep 3, save ~${(totalLen - 3 * avgLen).toFixed(0)} chars`,
    );

    if (avgLen < 200 || (avgLen < 700 && totalLen < 2500)) continue;

    const hitItems =
      instruction.trim()
        ? items.filter((it) => $doc(it).text().includes(instruction))
        : [];
    const keep = hitItems.length > 0 ? hitItems.slice(0, 6) : items.slice(0, 3);
    const keepSet = new Set<any>(keep);
    const removed = items.filter((it) => !keepSet.has(it));

    const sampleTexts: string[] = [];
    for (const rm of removed.slice(0, 5)) {
      const txt = $doc(rm).text().replace(/\s+/g, ' ').trim().slice(0, 40);
      if (txt) sampleTexts.push(txt);
    }

    const hintParts = [
      `[FAKE ELEMENT] ${removed.length} more items hidden, selector: "${sel}"`,
    ];
    if (sampleTexts.length) {
      hintParts.push('Hidden items: ' + sampleTexts.map((t) => `"${t}"`).join(','));
    }

    if (keep.length > 0) {
      $doc(keep[keep.length - 1]).after(`<div>${hintParts.join(' ')}</div>`);
    }
    for (const it of removed) $doc(it).remove();
  }

  // 二次优化（清理 cutlist 新插入内容的冗余属性）
  optimizeHtmlForTokens($doc);

  let ss = $doc.html() ?? html;
  console.log(
    `[get_html] Result: ${html.length} -> ${ss.length} chars after cutlist ` +
      `(${Math.round(100 - (ss.length * 100) / html.length)}% saved)`,
  );

  if (ss.length > maxchars) {
    const bodyEl = $doc('body')[0];
    if (bodyEl) smartTruncate($doc, bodyEl, maxchars);
    ss = $doc.html() ?? ss;
  }
  return ss;
}

// =============================================================================
// execute_js_rich（对应 Python 的 execute_js_rich）
// =============================================================================

/**
 * 执行 JS 并监控页面变化（DOM diff + 瞬态文字）。
 * 对应 Python 的 execute_js_rich。
 */
export async function executeJsRich(
  script: string,
  driver: TMWebDriver,
  noMonitor = false,
): Promise<Record<string, any>> {
  let lastHtml: string | null = null;
  if (!noMonitor) {
    try {
      lastHtml = await getHtml(driver, {
        cutlist: false,
        extraJs: TEMP_MONITOR_JS,
        maxchars: 9_999_999,
      });
    } catch {
      // 忽略，baseline 可选
    }
  }

  const beforeSids = new Set(Object.keys(driver.getSessionDict()));
  let result: any = null;
  let errorMsg: string | null = null;
  let reloaded = false;
  let newTabs: any[] = [];
  let response: any = {};

  try {
    console.log(`Executing: ${script.slice(0, 250)} ...`);
    response = await driver.executeJs(script);
    result = 'data' in response ? response.data : response.result;
    if (response.closed === 1) reloaded = true;
    await delay(1000);
  } catch (e: any) {
    let error = e.message ?? String(e);
    try {
      const parsed = JSON.parse(error);
      if (parsed && typeof parsed === 'object') delete parsed.stack;
      error = typeof parsed === 'object' ? JSON.stringify(parsed) : String(parsed);
    } catch {}
    errorMsg = error;
    console.log(`Error: ${errorMsg}`);
  }

  const rr: Record<string, any> = {
    status: errorMsg ? 'failed' : 'success',
    js_return: result,
    tab_id: driver.defaultSessionId,
  };

  if (reloaded) rr['reloaded'] = true;

  if (response.newTabs) {
    rr['newTabs'] = response.newTabs;
  } else {
    const afterSids = driver.getSessionDict();
    const newSids = Object.fromEntries(
      Object.entries(afterSids).filter(([k]) => !beforeSids.has(k)),
    );
    if (Object.keys(newSids).length > 0) {
      newTabs = Object.entries(newSids).map(([id, url]) => ({ id, url }));
      rr['newTabs'] = newTabs;
      rr['suggestion'] = '页面已刷新，以上新标签页在执行期间连接。';
    }
  }

  if (errorMsg) rr['error'] = errorMsg;
  if (noMonitor) return rr;

  if (!reloaded) {
    try {
      rr['transients'] = await getTempTexts(driver);
    } catch {
      rr['transients'] = [];
    }
  }

  if (!reloaded && newTabs.length === 0) {
    try {
      const currentHtml = await getHtml(driver, { cutlist: false, maxchars: 9_999_999 });
      if (lastHtml === null) throw new Error('no baseline');
      const diffData = findChangedElements(lastHtml, currentHtml);
      const changeCount: number = diffData['changed'] ?? 0;
      const topChange: string = diffData['top_change'] ?? '';
      let diffSummary = `DOM变化量: ${changeCount}`;
      if (topChange) diffSummary += `\n最显著变化:\n${topChange}`;
      const transients: any[] = rr['transients'] ?? [];
      if (changeCount === 0 && !transients.length && newTabs.length === 0) {
        diffSummary += ' (页面无变化)';
        rr['suggestion'] = '页面无明显变化';
      }
      rr['diff'] = diffSummary;
    } catch {
      rr['diff'] = '页面变化监控不可用';
    }
  }

  return rr;
}

// =============================================================================
// 内部工具
// =============================================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
