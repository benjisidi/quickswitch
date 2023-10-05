#!/usr/bin/env -S npx ts-node
// see https://github.com/cookpete/git-checkout-interactive/blob/master/index.js

import { search } from "fast-fuzzy";
import prompts from "prompts";
import util from "util";
import { exec } from "child_process";
import chalk from "chalk";
const execPromise = util.promisify(exec);

const truncate = (msg: string, max = 50) => {
  if (msg.length > max) {
    return msg.slice(0, max - 3).trim() + "...";
  }
  return msg;
};

type Branch = {
  name: string;
  lastCommit: string;
  message: string;
  author: string;
};

const displayBranch = (branch: Branch) => {
  return `${chalk.yellow(branch.name)}\t${chalk.green(
    branch.lastCommit
  )}\t${chalk.blue(truncate(branch.message))}\t${chalk.magenta(branch.author)}`;
};

const main = async () => {
  const rawBranches = await execPromise(
    "git for-each-ref --sort=-committerdate refs/heads --format='%(refname:short)|%(HEAD)%(refname:short)|%(committerdate:relative)|%(subject)|%(authorname)' --color=always"
  );
  const branches = rawBranches.stdout
    ?.split("\n")
    .filter((x) => !!x)
    .map((x) => {
      const parts = x.split("|");
      return {
        name: parts[1],
        lastCommit: parts[2],
        message: parts[3],
        author: parts[4],
      };
    });

  const filterBranches = (input: string, choices: prompts.Choice[]) => {
    if (!input) {
      return Promise.resolve(choices);
    }
    return Promise.resolve(
      search(
        input,
        choices.map((x) => x.value)
      )
    );
  };

  const target = await prompts(
    [
      {
        type: "autocomplete",
        name: "name",
        message: "Select a branch",
        choices: branches.map((branch) => ({
          title: displayBranch(branch),
          value: branch.name,
        })),
        suggest: filterBranches,
      },
    ],
    {
      onCancel: () => process.exit(0),
    }
  );

  if (target.name.startsWith("*")) {
    return;
  }
  await execPromise(`git checkout ${target.name.trim()}`);
};

main();
