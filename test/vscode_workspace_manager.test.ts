'use strict';
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as autoproj from '../src/autoproj';
import * as helpers from './helpers';
import * as TypeMoq from 'typemoq'
import * as events from 'events';
import * as url from 'url';

import { Manager } from '../src/vscode_workspace_manager'

describe("vscode_workspace_manager.Manager", function () {
    let s: helpers.TestSetup;
    let subject: Manager;

    beforeEach(function () {
        s = new helpers.TestSetup();
        helpers.init();
        subject = new Manager(s.context, s.workspaces, s.taskProvider,
            s.mockConfigManager.object, s.fileWatcher);
    })
    afterEach(function () {
        helpers.clear();
    })

    describe("handleNewFolder", function() {
        it("ignores folders that are not part of a workspace", function() {
            subject.handleNewFolder(0, '/some/where/over/the/rainbow');
            s.mockWorkspaces.verify(x => x.addFolder(TypeMoq.It.isAny()),
                TypeMoq.Times.never());
        })

        it("auto-adds the config folder on top of the workspace folder", function() {
            let root = s.createWorkspace('ws');
            s.mockWrapper.setup(x => x.workspaceFolders).returns(() => [])
            subject.handleNewFolder(0, `${root}/base/types`);
            let expectedFolder = { name: 'autoproj (ws)', uri: vscode.Uri.file(`${root}/autoproj`) }
            s.mockWrapper.verify(x => x.updateWorkspaceFolders(0, null, expectedFolder),
                TypeMoq.Times.once());
            s.mockWorkspaces.verify(x => x.addFolder(TypeMoq.It.isAny()),
                TypeMoq.Times.never())
        })

        it("sets up the workspace if it was not there already", async function() {
            let { mock, ws } = s.createAndRegisterWorkspace('ws');
            let info = ws.info();
            let existing = [{ index: 0, name: 'autoproj (ws)',
                uri: vscode.Uri.file(`${ws.root}/autoproj`) }]
            s.mockWrapper.setup(x => x.workspaceFolders).returns(() => existing)
            s.mockWorkspaces.setup(x => x.addFolder(`${ws.root}/autoproj`)).
                returns(() => { return { added: true, workspace: mock.object } })

            // mocking `subject` is a pain. We use these as a proxy to checking
            // that setupNewWorkspace was called
            //
            // This forced me to somehow use mock.object instead of mock.target,
            // which also forced me to setup all these method calls
            mock.setup(x => x.info()).returns(() => info)
            mock.setup(x => x.reload()).returns(() => info)
            mock.setup(x => x.ensureSyskitContextAvailable()).
                returns(() => Promise.resolve())

            s.mockConfigManager.setup(x => x.setupPackage(`${ws.root}/autoproj`)).
                returns(() => Promise.resolve(true));
            subject.handleNewFolder(0, `${ws.root}/autoproj`);
            mock.verify(x => x.ensureSyskitContextAvailable(),
                TypeMoq.Times.once());
            s.mockConfigManager.verify(x => x.setupPackage(`${ws.root}/autoproj`),
                TypeMoq.Times.once());
        })

        it("only sets up the package configuration if the workspace was registered", async function() {
            let { mock, ws } = s.createAndRegisterWorkspace('ws');
            let existing = [{ index: 0, name: 'autoproj (ws)',
                uri: vscode.Uri.file(`${ws.root}/autoproj`) }]
            s.mockConfigManager.setup(x => x.setupPackage(`${ws.root}/test`)).
                returns(() => Promise.resolve(true));
            s.mockWrapper.setup(x => x.workspaceFolders).returns(() => existing)
            subject.handleNewFolder(0, `${ws.root}/test`);
            s.mockConfigManager.verify(x => x.setupPackage(`${ws.root}/test`),
                TypeMoq.Times.once());
        })
    })

    describe("handleDeletedFolder", function() {
        let mock : any;
        let ws : autoproj.Workspace;
        let folder : string;

        beforeEach(function() {
            let ret = s.createAndRegisterWorkspace('ws');
            mock = ret.mock; ws = ret.ws;
            folder = helpers.mkdir('ws', 'a');
            s.workspaces.addFolder(folder);
        })

        it("does not dispose of the workspace if there is a folder still", function() {
            let otherFolder = helpers.mkdir('ws', 'b');
            s.workspaces.addFolder(otherFolder);

            let disposed = false;
            let disposable = new vscode.Disposable(() => disposed = true);
            ws.subscribe(disposable);
            subject.handleDeletedFolder(folder);
            assert.strictEqual(disposed, false);
        })

        it("disposes of the workspace when the last folder is removed", function() {
            let disposed = false;
            let disposable = new vscode.Disposable(() => disposed = true);
            ws.subscribe(disposable);
            subject.handleDeletedFolder(folder);
            assert.strictEqual(disposed, true);
        })
    })
})
