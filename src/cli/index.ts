#!/usr/bin/env node
import chalk from "chalk";
import { Command } from "commander";
import { CliApp } from "./CliApp.js";

const program = new Command();

program
  .name("nano-claude-code")
  .description("A lightweight Claude AI coding agent")
  .version("1.0.0")
  .action(() => {
    const cli = new CliApp();
    cli.start().catch((err) => {
      console.error(chalk.red("启动失败:"), err.message);
      process.exit(1);
    });
  });

program.parse();
