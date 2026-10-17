# Literally one person on the team needs this
{
  description = "Traffic simulation development shell";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
  };

  outputs = {nixpkgs, ...}: let
    forAllSystems = nixpkgs.lib.genAttrs [
      "aarch64-linux"
      "x86_64-linux"
      "x86_64-darwin"
      "aarch64-darwin"
    ];
  in {
    devShells = forAllSystems (
      system: let
        pkgs = nixpkgs.legacyPackages.${system};
      in {
        default = pkgs.mkShell {
          packages = builtins.attrValues {
            inherit
              (pkgs)
              nodejs
              pnpm
              ty
              ruff
              uv
              sumo
              ;
          };

          shellHook = ''
            # Python and its dependencies (sumolib, traci, libsumo) are managed by uv.
            export UV_PYTHON_PREFERENCE=only-managed
            export SUMO_HOME="${pkgs.sumo}/share/sumo"

            # Needed for python and sumo
            # The Linux libsumo wheel also links GUI libraries, even for headless runs.
            export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath (with pkgs;
              [
                stdenv.cc.cc.lib
                zlib
                glib
              ]
              ++ lib.optionals stdenv.hostPlatform.isLinux [
                libx11
                libxext
                libxrender
                libGL
                expat
              ])}:$LD_LIBRARY_PATH"
          '';
        };
      }
    );
  };
}
