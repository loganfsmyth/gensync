"use strict";

const n = require("eslint-plugin-n");
const prettierRecommended = require("eslint-plugin-prettier/recommended");

module.exports = [
  {
    ...n.configs["flat/recommended-script"],
    files: ["index.js"],
  },
  {
    files: ["test/**"],
    languageOptions: {
      ecmaVersion: 2017,
      sourceType: "script",
    },
  },
  prettierRecommended,
];
