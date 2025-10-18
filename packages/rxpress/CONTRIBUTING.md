# Contributing Guide

We'd love your help!

## Development Quick Start

To get the project started quickly, you can follow these steps.

1. Run `npm install` at the repository root.
2. Execute `npm run lint` and `npm test --workspace rxpress` before proposing changes.
3. Library documentation belongs in [`packages/rxpress/docs`](./packages/rxpress/docs); example application improvements should live under [`packages/examples/server`](./packages/examples/server).

## Report a bug or requesting feature

1. Reporting bugs is an important contribution. Please make sure to include:

- Expected and actual behavior
- Node version
- rxpress version
- Steps to reproduce

2. Request features or enhancements as issues by adding appropriate tags when submitting

#### Conventional commit

The project follows Conventional Commits and ships with Husky hooks to keep the codebase consistent.

The code base is linted before submission (no apologies are made for the code formatting requirements,
and if you have a liking for cuddle-braces then this repository probably isn't for you!).

That said, eslint and prettier are usually able to automatically reformat the code to allow submission.

### Fork

In the interest of keeping this repository clean and manageable, you should work from a fork. To create a fork, click the 'Fork' button at the top of the repository, then clone the fork locally using `git clone git@github.com:USERNAME/newintel.git`.

You should also add this repository as an "upstream" repo to your local copy, in order to keep it up to date. You can add this as a remote like so:

```bash
git remote add upstream https://github.com/mgscox/newintel.git

#verify that the upstream exists
git remote -v
```

To update your fork, fetch the upstream repo's branches and commits, then merge your main with upstream's main:

```bash
git fetch upstream
git checkout main
git merge upstream/main
```

Remember to always work in a branch of your local copy, as you might otherwise have to contend with conflicts in main.

## Development

### Tools used

- [NPM](https://npmjs.com)
- [TypeScript](https://www.typescriptlang.org/)
- [lerna](https://github.com/lerna/lerna) to manage dependencies, compilations, and links between packages. Most lerna commands should be run by calling the provided npm scripts.
- [npm workspaces](https://docs.npmjs.com/cli/v10/using-npm/workspaces)
- [eslint](https://eslint.org/)
- [prettier](https://prettier.io)

### General guidance

The `rxpress` project is written in TypeScript.

As a general rule, installing from the root directory should always be done first before anything else.
Packages within this repository might have dependencies between them. This means the dependencies should
be built before if you want to `build` or `test` the changes you've made in a package.

### CHANGELOG

The conventional commit type (in PR title) is very important to automatically bump versions on release. For instance:

- any type + `!` will bump major version (or minor on pre-release)
- `feat` will bump minor
- `fix` will bump patch

There is no need to update the CHANGELOG in a PR because it will be updated as part of the release process.

### Testing

Most unit tests case be run via:

```sh
npm run test
```
