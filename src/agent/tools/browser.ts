import { TMWebDriver } from '../../uitls/TMWebDriver.js';
import { getHtml, executeJsRich } from '../../uitls/simphtml.js';

/** 对应 Python 的 smart_format：保留头尾，中间省略 */
function smartFormat(data: string, maxStrLen = 100, omitStr = ' ... '): string {
  if (data.length < maxStrLen + omitStr.length * 2) return data;
  return data.slice(0, maxStrLen >> 1) + omitStr + data.slice(-(maxStrLen >> 1));
}

export interface WebScanOptions {
  /** 仅返回标签页列表，不获取页面内容（节省 token） */
  tabsOnly?: boolean;
  /** 切换到指定标签页 ID */
  switchTabId?: string;
  /** 仅返回纯文本而非简化 HTML */
  textOnly?: boolean;
}

/** 模块级 driver 单例 */
let _driver: TMWebDriver | null = null;

function getDriver(): TMWebDriver {
  if (!_driver) _driver = new TMWebDriver();
  return _driver;
}


/**
 * 获取当前浏览器页面内容和标签页列表。
 * 元数据 JSON + 可选 HTML 代码块，对应 Python 版的 do_web_scan 输出格式。
 */
export async function webScan(options: WebScanOptions = {}): Promise<string> {
  const { tabsOnly = false, switchTabId, textOnly = false } = options;

  try {
    const driver = getDriver();

    const sessions = driver.getAllSessions();
    if (sessions.length === 0) {
      return JSON.stringify({
        status: 'error',
        msg: '没有可用的浏览器标签页，请确认浏览器扩展已连接到 TMWebDriver。',
      });
    }

    if (switchTabId) {
      driver.defaultSessionId = switchTabId;
    }

    const tabs = sessions.map((s: any) => {
      const url: string = s.url ?? '';
      return {
        id: s.id,
        url: url.length > 50 ? url.slice(0, 50) + '...' : url,
        title: s.title ?? '',
      };
    });

    const metadata: Record<string, any> = {
      status: 'success',
      metadata: {
        tabs_count: tabs.length,
        tabs,
        active_tab: driver.defaultSessionId,
      },
    };

    if (tabsOnly) {
      return JSON.stringify(metadata);
    }

    let content: string | null = null;
    try {
      if (textOnly) {
        const text = await getHtml(driver, { textOnly: true });
        content = smartFormat(text, 10000, '\n\n[omitted long content]\n\n');
      } else {
        content = await getHtml(driver, { cutlist: true, maxchars: 35000 });
      }
    } catch (e: any) {
      metadata['content_error'] = e.message;
    }

    const metaStr = JSON.stringify(metadata);
    if (content) {
      return metaStr + `\n\`\`\`html\n${content}\n\`\`\``;
    }
    return metaStr;
  } catch (e: any) {
    return JSON.stringify({ status: 'error', msg: e.message });
  }
}

// 执行 JS 代码并返回结果
import * as fs from 'fs';

export interface WebExecuteJsOptions {
  /** 切换到指定标签页 ID */
  switchTabId?: string;
  /** 禁用页面变化监控（省 token，适合不需要 diff 的场景） */
  noMonitor?: boolean;
  /** 将 js_return 完整内容写入该文件路径，结果中只保留摘要 */
  saveToFile?: string;
}

/**
 * 执行 JS 脚本来控制浏览器，并捕获结果和页面变化。
 * 对应 Python 版的 web_execute_js 函数。
 * 返回截断后的 JSON 字符串（最长 8000 字符）。
 */
export async function webExecuteJs(
  script: string,
  options: WebExecuteJsOptions = {},
): Promise<string> {
  const { switchTabId, noMonitor = false, saveToFile } = options;

  try {
    const driver = getDriver();

    if (driver.getAllSessions().length === 0) {
      return JSON.stringify({ status: 'error', msg: '没有可用的浏览器标签页，请确认浏览器扩展已连接到 TMWebDriver。' });
    }

    if (switchTabId) {
      driver.defaultSessionId = switchTabId;
    }

    const result: Record<string, any> = await executeJsRich(script, driver, noMonitor);

    if (saveToFile && 'js_return' in result) {
      const content = String(result['js_return'] ?? '');
      result['js_return'] = smartFormat(content, 170);
      try {
        fs.writeFileSync(saveToFile, content, 'utf-8');
        result['js_return'] += `\n\n[已保存完整内容到 ${saveToFile}]`;
      } catch {
        result['js_return'] += `\n\n[保存失败，无法写入文件 ${saveToFile}]`;
      }
    }

    return smartFormat(JSON.stringify(result, null, 2), 8000);
  } catch (e: any) {
    return JSON.stringify({ status: 'error', msg: e.message });
  }
}
