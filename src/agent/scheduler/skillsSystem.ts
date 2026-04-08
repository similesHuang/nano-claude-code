
import { promises as fs } from "fs";
import * as path from "path";

/**
 * 技能清单 - 轻量元数据，常驻系统提示词
 */
export interface SkillManifest {
  name: string;
  description: string;
  path: string;
}

/**
 * 技能文档 - 清单 + 完整正文，按需加载
 */
interface SkillDocument {
  manifest: SkillManifest;
  body: string;
}

/**
 * SkillsSystem - 两层技能加载系统
 *
 * 设计思路（与 Python 参考实现对齐）：
 * 1. 启动时扫描 skills/ 目录，解析每个 SKILL.md 的 frontmatter → 生成轻量目录
 * 2. 轻量目录注入系统提示词，让模型知道有哪些技能可用
 * 3. 模型通过 load_skill 工具按需加载完整技能正文到上下文
 *
 * 这样既保持提示词精简，又让模型能按需获取任务专属指导。
 */
export class SkillsSystem {
  private skillsDir: string;
  private documents: Map<string, SkillDocument> = new Map();

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir || path.join(process.cwd(), "skills");
  }

  /**
   * 扫描 skills 目录，加载所有 SKILL.md 的元数据和正文
   */
  async init(): Promise<void> {
    this.documents.clear();

    try {
      await fs.access(this.skillsDir);
    } catch {
      return; // 目录不存在，静默跳过
    }

    const skillFiles = await this.findSkillFiles(this.skillsDir);

    for (const filePath of skillFiles) {
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const { meta, body } = this.parseFrontmatter(content);

        const name = meta.name || path.basename(path.dirname(filePath));
        const description = meta.description || "No description";
        const manifest: SkillManifest = { name, description, path: filePath };

        this.documents.set(name, { manifest, body: body.trim() });
      } catch {
        // 跳过无法解析的文件
      }
    }
  }

  /**
   * 生成技能目录摘要（注入系统提示词用）
   */
  describeCatalog(): string {
    if (this.documents.size === 0) {
      return "(no skills available)";
    }

    const lines: string[] = [];
    for (const name of [...this.documents.keys()].sort()) {
      const { description } = this.documents.get(name)!.manifest;
      lines.push(`- ${name}: ${description}`);
    }
    return lines.join("\n");
  }

  /**
   * 按需加载技能完整正文（load_skill 工具调用）
   */
  loadSkill(name: string): string {
    const doc = this.documents.get(name);

    if (!doc) {
      const known = [...this.documents.keys()].sort().join(", ") || "(none)";
      return `Error: Unknown skill '${name}'. Available: ${known}`;
    }

    return `<skill name="${doc.manifest.name}">\n${doc.body}\n</skill>`;
  }

  /**
   * 获取所有技能清单
   */
  getManifests(): SkillManifest[] {
    return [...this.documents.values()].map((d) => d.manifest);
  }

  /**
   * 是否有可用技能
   */
  hasSkills(): boolean {
    return this.documents.size > 0;
  }

  /**
   * 递归查找所有 SKILL.md 文件
   */
  private async findSkillFiles(dir: string): Promise<string[]> {
    const results: string[] = [];

    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await this.findSkillFiles(fullPath)));
      } else if (entry.name === "SKILL.md") {
        results.push(fullPath);
      }
    }

    return results.sort();
  }

  /**
   * 解析 YAML frontmatter（简易实现，不引入额外依赖）
   */
  private parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
    const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)/);

    if (!match) {
      return { meta: {}, body: text };
    }

    const meta: Record<string, string> = {};
    for (const line of match[1].split("\n")) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }

    return { meta, body: match[2] };
  }
}

// 全局单例
export const skillsSystem = new SkillsSystem();