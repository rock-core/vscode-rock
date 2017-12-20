import * as context from './context'
import * as wrappers from './wrappers'
import * as vscode from 'vscode'
import { basename, dirname } from 'path'
import * as async from './async'
import * as packages from './packages'

export class Target
{
    private readonly _name: string;
    private readonly _path: string;

    constructor(name: string, path: string)
    {
        this._name = name;
        this._path = path;
    }

    get name(): string
    {
        return this._name;
    }

    get path(): string
    {
        return this._path;
    }
}