'use strict';

import * as vscode from 'vscode';

export function forProcess(
    processId: number, signal : string = 'SIGINT') : vscode.Disposable {
    return new vscode.Disposable(() => {
        try {
            process.kill(processId, signal);
        }
        catch(err) { }
    })
}

export function forTask(
    execution: vscode.TaskExecution) : vscode.Disposable {
    return new vscode.Disposable(() => {
        execution.terminate()
    })
}
