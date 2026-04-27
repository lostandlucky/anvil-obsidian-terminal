import { App, PluginSettingTab, Setting } from "obsidian";
import { buildSettingsControlSpecs, SettingsTabHost } from "./settings-controls";

// Re-export so existing imports of `SettingsTabHost` from settings-tab keep
// working without a follow-up file shuffle.
export type { SettingsTabHost } from "./settings-controls";
export { buildSettingsControlSpecs } from "./settings-controls";

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

    for (const spec of buildSettingsControlSpecs(this.host)) {
      const setting = new Setting(containerEl).setName(spec.name).setDesc(spec.desc);

      switch (spec.kind) {
        case "text":
          if (spec.multiline) {
            setting.addTextArea((text) => {
              if (spec.placeholder) text.setPlaceholder(spec.placeholder);
              text
                .setValue(spec.getValue())
                .onChange(async (value) => {
                  await spec.setValue(value);
                });
              text.inputEl.rows = 4;
              text.inputEl.cols = 40;
            });
          } else {
            setting.addText((text) => {
              if (spec.placeholder) text.setPlaceholder(spec.placeholder);
              text
                .setValue(spec.getValue())
                .onChange(async (value) => {
                  await spec.setValue(value);
                });
            });
          }
          break;

        case "toggle":
          setting.addToggle((toggle) =>
            toggle.setValue(spec.getValue()).onChange(async (value) => {
              await spec.setValue(value);
            }),
          );
          break;

        case "dropdown":
          setting.addDropdown((dropdown) => {
            for (const [value, label] of Object.entries(spec.options)) {
              dropdown.addOption(value, label);
            }
            dropdown.setValue(spec.getValue()).onChange(async (value) => {
              await spec.setValue(value);
            });
          });
          break;
      }
    }
  }
}
