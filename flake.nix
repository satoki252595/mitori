{
  description = "mitori - living design docs for any repository, co-reviewed by humans and AI agents";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        # toolchains the fixtures' gates and hidden tests need (go-small, py-small, rust-small)
        fixtureToolchains = with pkgs; [ go python3 rustc cargo rustfmt ];
      in
      {
        # local development (scripts/nd uses this one)
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            bun
            nodejs_22
            git
            gh
            jq
            ripgrep
            hyperfine
          ];
          shellHook = ''
            export MITORI_DEV=1
            export PATH="$PWD/node_modules/.bin:$PATH"
          '';
        };

        # GitHub-hosted PR job (MILESTONES §9): slim — no gh/ripgrep/hyperfine; Playwright's chromium and
        # CJK fonts are added by WP-12 for the e2e-pr job only.
        devShells.ci = pkgs.mkShell {
          packages = (with pkgs; [ bun nodejs_22 git jq ]) ++ fixtureToolchains;
          shellHook = ''
            export MITORI_CI=1
            export PATH="$PWD/node_modules/.bin:$PATH"
          '';
        };
      });
}
