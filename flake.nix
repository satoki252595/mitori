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
      in
      {
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
      });
}
