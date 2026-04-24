import * as fs from 'fs';
import * as path from 'path';
import { getDataDir } from '../config';


// ------config.json 文件结构定义------------
export interface ConfigFile {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

// 获取文件
function getConfigPath(): string {
  return path.join(getDataDir(), 'config.json');
}

export function loadConfigFile():ConfigFile  {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const data = JSON.parse(raw);
      return {
        apiKey: data.apiKey || data.ANTHROPIC_API_KEY,
        baseUrl: data.baseUrl || data.ANTHROPIC_BASE_URL,
        model: data.model || data.CLAUDE_MODEL,
      };
    }
  } catch {
    // 配置文件解析失败时忽略
  }
  return {};
}


export function saveConfigFile(config: ConfigFile): void {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}
