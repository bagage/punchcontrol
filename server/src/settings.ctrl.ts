import { safeDump, safeLoad } from 'js-yaml';
import { async } from './util/async';
import { Service } from 'typedi';
import { join as pathJoin } from 'path';
import { LOGGING } from './util/logging';

const LOGGER = LOGGING.getLogger(__filename);

export type AppMode = 'STANDALONE' | 'MAIN' | 'SECONDARY';

export interface AppSettings {
    port: number;
    mode: AppMode;
    recents: string[];
    masterUrl: string|null;
}
const DEFAULT_SETTINGS: AppSettings = {
    port: 3000,
    mode: 'STANDALONE',
    recents: [],
    masterUrl: null,
}

@Service()
export class SettingsManager implements AppSettings {
    private settings: AppSettings;

    private appFolder: string;
    private settingsFilePath: string;
    private recordScheduled = false;

    async initialize(appFolder: string) {
        this.appFolder = appFolder;
        this.settingsFilePath = pathJoin(appFolder, 'settings.yaml');
        this.settings = DEFAULT_SETTINGS;
        try {
            const str = await async.readFile(this.settingsFilePath, 'utf8');
            Object.assign(this.settings, safeLoad(str)); // make sure we load all default value
            LOGGER.info(`Settings loaded correctly from ${this.settingsFilePath}`);
        } catch (e) {
            LOGGER.warn(`Could not read settings (using default settings): ${e}`);
        }
        if (this.settings.recents.length === 0) {
            this.addRecent(pathJoin(this.appFolder, 'default.punch'));
        }
        this.rec(); // we want the default values to be in the file for self-documenting conf
    }
    get port() { return this.settings.port }
    set port(port: number) { this.settings.port = port; this.rec() }

    get recents() { return this.settings.recents }
    addRecent(path: string) {
        const count = this.recents.unshift(path);
        if (count > 6) {
            this.recents.pop();
        }
        this.rec();
    }

    get mode() { return this.settings.mode }
    set mode(mode: AppMode) { this.settings.mode = mode; this.rec() }

    get masterUrl() { return this.settings.masterUrl }
    set masterUrl(url: string|null){ this.settings.masterUrl = url; this.rec() }

    export(): AppSettings{
        return Object.assign({}, this.settings);
    }
    import(settings: any): void {
        Object.assign(this.settings, settings);
        this.rec();
    }
    private async save() {
        try {
            const str = safeDump(this.settings);
            async.writeFile(this.settingsFilePath, str, { encoding: 'utf8' });
            LOGGER.info(`Settings saved correctly to ${this.settingsFilePath}`);
        } catch (e) {
            LOGGER.warn(`Could not save settings: ${e}`);
        }

    }
    private rec() {
        if (!this.recordScheduled) {
            this.recordScheduled = true;
            setTimeout(async () => {
                await this.save();
                this.recordScheduled = false;
            }, 2000);
        }
    }
}
