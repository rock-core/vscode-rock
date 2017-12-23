'use strict';
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as TypeMoq from 'typemoq';
import * as status from '../status';
import * as wrappers from '../wrappers';
import * as context from '../context';
import * as helpers from './helpers';
import * as autoproj from '../autoproj';
import * as tasks from '../tasks';
import { basename, relative } from 'path';
import * as debug from '../debug';
import * as commands from '../commands';
import * as packages from '../packages'

async function assertThrowsAsync(fn, msg?: RegExp)
{
    let f = () => {};
    try {
        await fn();
    }
    catch (e)
    {
        f = () => {throw e};
    }
    finally
    {
        assert.throws(f, msg);
    }
}

describe("Commands", function () {
    let root: string;
    let workspaces: autoproj.Workspaces;
    let mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    let mockContext: TypeMoq.IMock<context.Context>;
    let mockPackage: TypeMoq.IMock<packages.Package>;
    let subject: commands.Commands;

    let a: string;
    let b: string;
    let c: string;
    let folders: vscode.WorkspaceFolder[];
    beforeEach(function () {
        root = helpers.init();

        workspaces = new autoproj.Workspaces()
        folders = new Array<vscode.WorkspaceFolder>();
        mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        mockContext = TypeMoq.Mock.ofType<context.Context>();
        mockPackage = TypeMoq.Mock.ofType<packages.Package>();
        subject = new commands.Commands(mockContext.object);
        mockContext.setup(x => x.workspaces).returns(() => workspaces);

        helpers.mkdir('one');
        helpers.mkdir('two');
        helpers.mkdir('one', '.autoproj');
        helpers.mkdir('two', '.autoproj');

        helpers.createInstallationManifest([], 'one');
        helpers.createInstallationManifest([], 'two');
        helpers.mkdir('one', 'drivers');
        helpers.mkdir('two', 'firmware');
        a = helpers.mkdir('one', 'drivers', 'iodrivers_base');
        b = helpers.mkdir('one', 'drivers', 'auv_messaging');
        c = helpers.mkdir('two', 'firmware', 'chibios');

        workspaces.addFolder(a);
        workspaces.addFolder(b);
        workspaces.addFolder(c);
        mockContext.setup(x => x.vscode).returns(() => mockWrapper.object);

        let index = 0;
        workspaces.forEachFolder((ws, folder) => {
            let candidate: vscode.WorkspaceFolder = {
                uri: vscode.Uri.file(folder),
                name: basename(folder),
                index: index
            }
            folders.push(candidate);
            index++;
        });
        mockWrapper.setup(x => x.workspaceFolders).returns(() => folders);
    })
    afterEach(function () {
        helpers.clear();
    })
    describe("selectPackage", function () {
        it("shows a quick picker with all packages", async function () {
            let expectedChoices = new Array<{
                label: string,
                description: string,
                path: string
            }>();

            let chosen = {
                label: "drivers/iodrivers_base",
                description: "one",
                path: a
            };
            workspaces.forEachFolder((ws, folder) => {
                expectedChoices.push({
                    label: relative(ws.root, folder),
                    description: ws.name,
                    path: folder
                });
            });

            mockWrapper.setup(x => x.showQuickPick(expectedChoices, TypeMoq.It.isAny())).
                returns(() => Promise.resolve(chosen));

            await subject.selectPackage();
            mockWrapper.verify(x => x.showQuickPick(expectedChoices,
                TypeMoq.It.isAny()), TypeMoq.Times.once());
            mockContext.verify(x => x.setSelectedPackage(chosen.path), TypeMoq.Times.once());
        });
    })
    describe("actions on the package", function () {
        beforeEach(function () {
            mockPackage.setup((x: any) => x.then).returns(() => undefined);
            mockContext.setup(x => x.getSelectedPackage()).
                returns(() => Promise.resolve(mockPackage.object));
        });
        describe("buildPackage", function () {
            it("handles exceptions thrown in the promise", async function () {
                mockPackage.setup(x => x.build()).returns(() => Promise.reject(new Error("test")));
                await subject.buildPackage();
                mockWrapper.verify(x => x.showErrorMessage("test"), TypeMoq.Times.once());
            });
        })
        describe("selectPackageType", function () {
            it("handles exceptions thrown in the promise", async function () {
                mockPackage.setup(x => x.pickType()).returns(() => Promise.reject(new Error("test")));
                await subject.selectPackageType();
                mockWrapper.verify(x => x.showErrorMessage("test"), TypeMoq.Times.once());
            });
        })
        describe("setDebuggingTarget", function () {
            it("handles exceptions thrown in the promise", async function () {
                mockPackage.setup(x => x.pickTarget()).returns(() => Promise.reject(new Error("test")));
                await subject.setDebuggingTarget();
                mockWrapper.verify(x => x.showErrorMessage("test"), TypeMoq.Times.once());
            });
        })
        describe("debugPackage", function () {
            it("handles exceptions thrown in the promise", async function () {
                mockPackage.setup(x => x.debug()).returns(() => Promise.reject(new Error("test")));
                await subject.debugPackage();
                mockWrapper.verify(x => x.showErrorMessage("test"), TypeMoq.Times.once());
            });
        })
    })
});
