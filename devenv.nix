{ pkgs, ... }:

{
	languages.javascript = {
		enable = true;
		package = pkgs.nodejs_24;
		npm.enable = true;
		npm.install.enable = true;
	};
	processes.dev.exec = "npm run dev";
}
