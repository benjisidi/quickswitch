#!/usr/bin/env node
// see https://github.com/cookpete/git-checkout-interactive/blob/master/index.js

import { search } from "fast-fuzzy";
import prompts from "prompts";
import util from "util";
import { exec } from "child_process";
import chalk from "chalk";
import { program } from "commander";
program.option("--recent");

const execPromise = util.promisify(exec);

const uniq = (arr: string[]) => {
  const seen = new Set();
  const unique = [];
  for (const item of arr) {
    if (!seen.has(item)) {
      unique.push(item);
      seen.add(item);
    }
  }
  return unique;
};

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

const displayBranch = (branch: Branch, longestName: number) => {
  const maxChars = process.stdout.columns || 80;
  let availableChars = maxChars - longestName - 13 - 15 - 15 - 9 - 7;
  let nameLength = longestName;
  let showAuthor = true;
  // First, try hiding the author
  if (availableChars <= 3) {
    showAuthor = false;
    availableChars += 15;
  }
  // Then, truncate the branch name too
  if (availableChars <= 3) {
    nameLength = longestName - (3 - availableChars);
    availableChars += longestName - nameLength;
  }
  let message = [];
  // Commit name
  message.push(
    chalk.yellow(truncate(branch.name, nameLength).padEnd(nameLength, " "))
  );
  // Last commit timestamp
  message.push(chalk.green(branch.lastCommit.padEnd(13, " ")));
  // Message
  message.push(
    chalk.blue(
      truncate(branch.message, availableChars).padEnd(availableChars, " ")
    )
  );
  if (showAuthor) {
    message.push(chalk.magenta(truncate(branch.author, 15)));
  }
  return message.join(" | ");
};

const selectRecentBranch = async (
  branches: Branch[],
  longestName: number
): Promise<Branch> => {
  const rawRecentCheckouts = await execPromise(
    'git log -g --grep-reflog "checkout:" --format="%gs" --max-count=50'
  );
  let recentCheckouts = rawRecentCheckouts.stdout
    ?.split("\n")
    .filter((x) => !!x)
    .map((x) => x.slice(22).split(" to ")[1]);
  recentCheckouts = uniq(recentCheckouts);
  const branchLookup = branches.reduce(
    (acc: { [name: string]: Branch }, cur) => {
      acc[cur.name] = cur;
      return acc;
    },
    {}
  );
  for (let i = 0; i < recentCheckouts.length; i++) {
    const branchName = recentCheckouts[i];
    if (!branchLookup[branchName]) {
      // We must have just a commit hash here, let's go get the deets
      const rawCommitDetails = (
        await execPromise(`git show ${branchName} --format="%H|%ar|%s|%an"`)
      ).stdout
        .split("\n")
        .filter((x) => !!x)[0]
        .split("|");
      branchLookup[branchName] = {
        name: rawCommitDetails[0],
        lastCommit: rawCommitDetails[1],
        message: rawCommitDetails[2],
        author: rawCommitDetails[3],
      };
    }
    console.log(
      `[${i.toString()}] `.padStart(5, " ") +
        displayBranch(branchLookup[branchName], longestName)
    );
  }
  const target = await prompts(
    [
      {
        type: "number",
        name: "selection",
        message: "Select a branch",
        validate: (value) => value >= 0 && value < recentCheckouts.length,
      },
    ],
    {
      onCancel: () => process.exit(0),
    }
  );
  return branchLookup[recentCheckouts[target.selection]];
};

const selectSearchedBranch = async (
  branches: Branch[],
  longestName: number
): Promise<Branch> => {
  const filterBranches = (input: string, choices: prompts.Choice[]) => {
    if (!input) {
      return Promise.resolve(choices);
    }
    return Promise.resolve(
      search(
        input,
        choices.map((x) => displayBranch(x.value, longestName))
      )
    );
  };

  const target = await prompts(
    [
      {
        type: "autocomplete",
        name: "selection",
        message: "Select a branch",
        choices: branches.map((branch) => ({
          title: displayBranch(branch, longestName),
          value: branch,
        })),
        suggest: filterBranches,
      },
    ],
    {
      onCancel: () => process.exit(0),
    }
  );

  return target.selection;
};

const main = async () => {
  try {
    await execPromise("git rev-parse --is-inside-work-tree");
  } catch (_) {
    console.log("Not a git repository");
    process.exit(1);
  }
  program.parse();
  const opts = program.opts();
  const rawBranches = await execPromise(
    "git for-each-ref --sort=-committerdate refs/heads --format='%(refname:short)|%(HEAD)%(refname:short)|%(committerdate:relative)|%(subject)|%(authorname)' --color=always"
  );
  const branches = rawBranches.stdout
    ?.split("\n")
    .filter((x) => !!x)
    .map((x) => {
      const parts = x.split("|");
      return {
        name:
          parts[1].trim().charAt(0) === "*"
            ? parts[1].trim().substring(1)
            : parts[1].trim(),
        lastCommit: parts[2],
        message: parts[3],
        author: parts[4],
      };
    });

  const longestName = branches.reduce((acc, cur) => {
    if (cur.name.length > acc) {
      return cur.name.length;
    }
    return acc;
  }, 0);
  console.log(longestName);
  let target: Branch;
  if (opts.recent) {
    target = await selectRecentBranch(branches, longestName);
  } else {
    target = await selectSearchedBranch(branches, longestName);
  }

  await execPromise(`git checkout ${target.name.trim()}`);
};

main();
