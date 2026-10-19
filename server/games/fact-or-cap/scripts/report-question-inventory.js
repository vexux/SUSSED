#!/usr/bin/env node

const { TARGETS } = require("./manage-question-batch");
const { buildQuestionInventory, formatQuestionInventory } = require("../questionInventory");

const inventory = buildQuestionInventory({ contentDirectories: TARGETS });
process.stdout.write(`${formatQuestionInventory(inventory)}\n`);
if (inventory.hasErrors) process.exitCode = 1;
