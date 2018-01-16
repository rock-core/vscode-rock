import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export class FileWatcher implements vscode.Disposable
{
    private readonly _fileToWatcher: Map<string, fs.FSWatcher>;
    private readonly _fileToFilter: Map<string, any>;
    constructor()
    {
        this._fileToWatcher = new Map<string, fs.FSWatcher>();
        this._fileToFilter = new Map<string, any>();
    }
    startWatching(filePath: string,
        callback: (filePath: string) => void): boolean
    {
        if (this._fileToWatcher.has(filePath))
            return false;

        let fileName = path.basename(filePath);
        let fileDir = path.dirname(filePath);
        this._fileToWatcher.set(filePath, fs.watch(fileDir, (type, file) => {
            if (file == fileName) {
                if (!this._fileToFilter.has(filePath)) {
                    callback(filePath);
                    // sometimes the callback is called multiple times for a single event
                    this._fileToFilter.set(filePath, setTimeout(() => {
                        this._fileToFilter.delete(filePath);
                    }, 1000))
                }
            }
        }));
        return true;
    }
    stopWatching(filePath: string): void
    {
        let watcher = this._fileToWatcher.get(filePath);
        if (!watcher)
            throw new Error(`${filePath}: Not being watched`);

        watcher.close();
        this._fileToWatcher.delete(filePath);
        this._fileToFilter.delete(filePath);
    }
    dispose(): void {
        this._fileToWatcher.forEach((watcher) => {
            watcher.close();
        })
        this._fileToWatcher.clear();
        this._fileToFilter.clear();
    }
}