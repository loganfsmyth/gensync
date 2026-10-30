"use strict";

module.exports = {
  overrides: [
    {
      test: "./test",
      presets: [["@babel/preset-env", { targets: { node: "current" } }]],
    },
  ],
};
