'use strict';
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as TypeMoq from 'typemoq';
import * as wrappers from '../src/wrappers';
import * as tasks from '../src/tasks';
import * as context from '../src/context';
import * as autoproj from '../src/autoproj';
import * as helpers from './helpers';
import * as packages from '../src/packages';
import { basename, join } from 'path';
import * as fs from 'fs'
import * as debug from '../src/debug'

class TestContext
{
    root: string;
    mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    mockPackageFactory: TypeMoq.IMock<packages.PackageFactory>;
    workspaces: autoproj.Workspaces;

    workspaceFolders: vscode.WorkspaceFolder[];

    subject: context.Context;
    constructor()
    {
        this.root = helpers.init();
        this.mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        this.mockWrapper.setup(x => x.workspaceFolders)
            .returns(() => this.workspaceFolders);
        let packageFactory = new packages.PackageFactory(this.mockWrapper.object);
        this.mockPackageFactory = TypeMoq.Mock.ofInstance(packageFactory);
        this.mockPackageFactory.callBase = true;
        this.workspaces = new autoproj.Workspaces;
        let mockOutputChannel = TypeMoq.Mock.ofType<vscode.OutputChannel>();
        mockOutputChannel.setup(x => x.dispose()).returns(() => undefined)

        this.subject = new context.Context(
            this.mockWrapper.object,
            this.workspaces,
            this.mockPackageFactory.object,
            mockOutputChannel.object);
    }

    clear(): void
    {
        helpers.clear();
    }
}

describe("Context tests", function () {
    let testContext: TestContext;
    beforeEach(function () {
        testContext = new TestContext;
    })
    afterEach(function () {
        testContext.clear();
    })

    function verifyContextUpdated(times) {
        const mock = TypeMoq.Mock.ofInstance(() => undefined);
        mock.object();
        testContext.subject.onUpdate(mock);
        mock.verify(x => x(), times);
    }
    it("returns the given workspaces", function () {
        assert.strictEqual(testContext.workspaces, testContext.subject.workspaces);
    });
    it("calls envsh and fires the update event", async function () {
        const mockWs = TypeMoq.Mock.ofType<autoproj.Workspace>();
        await testContext.subject.updateWorkspaceInfo(mockWs.object);
        mockWs.verify(x => x.envsh(), TypeMoq.Times.once());
        verifyContextUpdated(TypeMoq.Times.once());
    })

});
