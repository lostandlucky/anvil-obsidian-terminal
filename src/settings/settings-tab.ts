import { App, PluginSettingTab, Setting } from "obsidian";
import { AnvilSettings } from "./settings";

export interface SettingsTabHost {
  app: App;
  getSettings(): AnvilSettings;
  updateSettings(patch: Partial<AnvilSettings>): Promise<void>;
}

interface PluginLike {
  app: App;
}

export class AnvilSettingsTab extends PluginSettingTab {
  constructor(
    plugin: PluginLike & { app: App } & import("obsidian").Plugin,
    private readonly host: SettingsTabHost,
  ) {
    super(plugin.app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const settings = this.host.getSettings();

    new Setting(containerEl)
      .setName("Default shell")
      .setDesc(
        "Resolved path of the shell launched by default (plus-icon, picker Enter on the default row). Leave empty to fall back to $SHELL.",
      )
      .addText((text) =>
        text
          .setPlaceholder("/bin/zsh")
          .setValue(settings.defaultShell)
          .onChange(async (value) => {
            await this.host.updateSettings({ defaultShell: value.trim() });
          }),
      );

    new Setting(containerEl)
      .setName("Additional shells")
      .setDesc(
        "Extra shell paths to include in the picker, one per line. Only paths that exist on disk are shown.",
      )
      .addTextArea((text) => {
        text
          .setPlaceholder("/opt/homebrew/bin/fish\n/usr/local/bin/nu")
          .setValue(settings.userShellList.join("\n"))
          .onChange(async (value) => {
            const list = value
              .split("\n")
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            await this.host.updateSettings({ userShellList: list });
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 40;
      });

    new Setting(containerEl)
      .setName("Preserve tmux session dimensions on attach")
      .setDesc(
        "When off (default), attaching to a tmux session resizes it to match the pane. When on, the session keeps its current dimensions.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(settings.preserveTmuxDimensions)
          .onChange(async (value) => {
            await this.host.updateSettings({ preserveTmuxDimensions: value });
          }),
      );
  }
}
