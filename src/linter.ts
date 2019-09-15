import { languages, DiagnosticCollection } from 'vscode';
import { Diagnostic, DiagnosticSeverity, Disposable, Range, TextDocument } from 'vscode';
import * as context from './context';
import * as wrapper from './wrappers';

export class Linter implements Disposable {
    private _timer: NodeJS.Timer;
    constructor(private _context: context.Context,
                private _wrapper: wrapper.VSCode,
                private _diagnosticCollection: DiagnosticCollection) {
    }

    public start(): void {
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this.lintDocument(), 1000);
    }

    public async lintDocument(): Promise<DiagnosticCollection | undefined> {
        let diagnostics: DiagnosticCollection | undefined;
        if (this._wrapper.activeTextEditor) {
            let document = this._wrapper.activeTextEditor.document
            if (this.isSupportedLanguage(document.languageId) &&
                this.isPartOfWorkspace(document.fileName)) {
                diagnostics = this.parseResults(await this.runVera(document.fileName));
            }
        }
        return diagnostics;
    }

    public dispose(): void {
        clearTimeout(this._timer);
    }

    private isPartOfWorkspace(fileName: string): boolean {
        let ws = this._wrapper.getWorkspaceFolder(fileName);
        return ws ? (this._context.getWorkspaceByPath(ws.uri.fsPath) != undefined) : false;
    }

    private isSupportedLanguage(language: string): boolean {
        const supportedLanguages = ["c", "cpp"];
        return (supportedLanguages.indexOf(language) >= 0);
    }

    private async runVera(fileName: string): Promise<string> {
        let ws = this._wrapper.getWorkspaceFolder(fileName);
        let autoprojWs = this._context.getWorkspaceByPath(ws!.uri.fsPath);
        let autoprojProcess = autoprojWs!.autoprojExec('vera++', [fileName]);
        let output = '';

        autoprojProcess.stdout.on('data', (buffer) => output = output.concat(buffer.toString()))
        return new Promise<string>((resolve, reject) => {
            autoprojProcess.on('exit', (code, signal) => {
                if (code !== 0) {
                    reject(new Error(`Unable to run linter`))
                }
                else {
                    resolve(output.trim());
                }
            })
        })
    }

    private parseResults(result: string): DiagnosticCollection {
        this._diagnosticCollection.clear();

        // 1 = path, 2 = line, 3 = message
        let regex = /^(.*):([0-9]+):\s*(.*)/gm;
        let regexArray: RegExpExecArray | null;
        let fileData: { [key: string]: RegExpExecArray[] } = {};
        while (regexArray = regex.exec(result)) {
            if (regexArray[1] === undefined || regexArray[2] === undefined
                || regexArray[3] === undefined) {
                continue;
            }

            let fileName = regexArray[1];
            if (!(fileName in fileData)) {
                fileData[fileName] = [];
            }
            fileData[fileName].push(regexArray);
        }

        for (let fileName in fileData) {
            this._wrapper.openTextDocument(fileName).then((doc: TextDocument) => {
                let diagnostics: Diagnostic[] = [];
                for (let index = 0; index < fileData[fileName].length; index++) {
                    let array = fileData[fileName][index];
                    let line = Number(array[2]);
                    let message = array[3];
                    if (line > 0) {
                        line--;
                    }

                    let l = doc.lineAt(line);
                    let r = new Range(line, 0, line, l.text.length);
                    let d = new Diagnostic(r, `${message}`, DiagnosticSeverity.Information);
                    d.source = 'lint';
                    diagnostics.push(d);
                }
                this._diagnosticCollection.set(doc.uri, diagnostics);
            });
        }
        return this._diagnosticCollection;
    }
}