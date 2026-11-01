export default {
  bail: true,
  clearMocks: true,
  collectCoverageFrom: [
    "dist/**/*.js",
  ],
  coverageDirectory: "./tests/coverage",
  coverageProvider: "v8",
  errorOnDeprecated: true,
  moduleFileExtensions: [
    "js",
    "mjs",
  ],
  moduleNameMapper: {},
  testEnvironment: "node",
  testMatch: [
    "<rootDir>/tests/**/*.test.js",
  ],
  testPathIgnorePatterns: [
    "/node_modules/",
    "/tests/coverage/",
  ],
  transform: {},
  transformIgnorePatterns: [
    "/node_modules/"
  ],
  verbose: true
};
