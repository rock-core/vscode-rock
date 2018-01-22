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
import * as async from '../src/async';
import { basename, join } from 'path';
import * as fs from 'fs'
import * as debug from '../src/debug'

class TestContext
{
    root: string;
    mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    mockPackageFactory: TypeMoq.IMock<packages.PackageFactory>;
    mockBridge: TypeMoq.IMock<async.EnvironmentBridge>;
    workspaces: autoproj.Workspaces;

    workspaceFolders: vscode.WorkspaceFolder[];

    subject: context.Context;
    constructor()
    {
        this.root = helpers.init();
        this.mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        this.mockWrapper.setup(x => x.workspaceFolders)
            .returns(() => this.workspaceFolders);
        this.mockBridge = TypeMoq.Mock.ofType<async.EnvironmentBridge>();
        let packageFactory = new packages.PackageFactory(this.mockWrapper.object, this.mockBridge.object);
        this.mockPackageFactory = TypeMoq.Mock.ofInstance(packageFactory);
        this.mockPackageFactory.callBase = true;
        this.workspaces = new autoproj.Workspaces;

        this.subject = new context.Context(
            this.mockWrapper.object,
            this.workspaces,
            this.mockPackageFactory.object);
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
    it ("creates an output channel when instantiated", function () {
        let mockOutputChannel = TypeMoq.Mock.ofType<vscode.OutputChannel>();
        let mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        let mockWorkspaces = TypeMoq.Mock.ofType<autoproj.Workspaces>();
        let mockPackageFactory = TypeMoq.Mock.ofType<packages.PackageFactory>();

        mockWrapper.setup(x => x.createOutputChannel("Rock")).
            returns(() => mockOutputChannel.object);
        let subject = new context.Context(mockWrapper.object, mockWorkspaces.object,
            mockPackageFactory.object);
        mockWrapper.verify(x => x.createOutputChannel("Rock"), TypeMoq.Times.once());
        assert.strictEqual(subject.outputChannel, mockOutputChannel.object);
    });
    it("returns the given workspaces", function () {
        assert.strictEqual(testContext.workspaces, testContext.subject.workspaces);
    });
    it("calls envsh and fires the update event", async function () {
        const mockWs = TypeMoq.Mock.ofType<autoproj.Workspace>();
        await testContext.subject.updateWorkspaceInfo(mockWs.object);
        mockWs.verify(x => x.envsh(), TypeMoq.Times.once());
        verifyContextUpdated(TypeMoq.Times.once());
    })

    describe("hasValidSyskitContext", function() {
        let s : helpers.TestSetup;
        let subject : context.Context;
        beforeEach(function() {
            s = new helpers.TestSetup();
            subject = s.context;
        })

        it ("returns false if the default bundle does not exist", async function() {
            let { ws } = s.createAndRegisterWorkspace('ws');
            let isValid = await subject.hasValidSyskitContext(ws);
            assert(!isValid);
        })
        it ("returns false if syskit check fails within the default bundle", async function() {
            let { mock, ws } = s.createAndRegisterWorkspace('ws');
            let bundlePath = helpers.mkdir('ws', '.vscode', 'rock-default-bundle');
            mock.setup(x => x.syskitCheckApp(bundlePath)).
                returns(() => Promise.reject(new Error("not valid")));
            let isValid = await subject.hasValidSyskitContext(ws);
            assert(!isValid);
        })
        it ("returns true if the default bundle exists and is validated by syskit check", async function() {
            let { mock, ws } = s.createAndRegisterWorkspace('ws');
            let bundlePath = helpers.mkdir('ws', '.vscode', 'rock-default-bundle');
            mock.setup(x => x.syskitCheckApp(bundlePath)).
                returns(() => Promise.resolve());
            let isValid = await subject.hasValidSyskitContext(ws);
            assert(isValid);
        })
        it ("does not run an explicit check if the bundle has been verified and the folder exists", async function() {
            let { mock, ws } = s.createAndRegisterWorkspace('ws');
            let bundlePath = helpers.mkdir('ws', '.vscode', 'rock-default-bundle');
            let count = 0;
            mock.setup(x => x.syskitCheckApp(bundlePath)).
                returns(() => { count += 1; return Promise.resolve() });
            await subject.hasValidSyskitContext(ws);
            await subject.hasValidSyskitContext(ws);
            assert.equal(1, count);
        })
        it ("returns false if the bundle does not exist even after a successful check", async function() {
            let { mock, ws } = s.createAndRegisterWorkspace('ws');
            let bundlePath = helpers.mkdir('ws', '.vscode', 'rock-default-bundle');
            mock.setup(x => x.syskitCheckApp(bundlePath)).
                returns(() => Promise.resolve());
            await subject.hasValidSyskitContext(ws);
            helpers.rmdir('ws', '.vscode', 'rock-default-bundle');
            let isValid = await subject.hasValidSyskitContext(ws);
            assert(!isValid);
        })
        it ("does not cache negative results", async function() {
            let { mock, ws } = s.createAndRegisterWorkspace('ws');
            let bundlePath = helpers.mkdir('ws', '.vscode', 'rock-default-bundle');
            let count = 0;
            mock.setup(x => x.syskitCheckApp(bundlePath)).
                returns(() => { count += 1; return Promise.reject(new Error("test")) });
            await subject.hasValidSyskitContext(ws);
            await subject.hasValidSyskitContext(ws);
            assert.equal(2, count);
        })
    })

    describe("ensureSyskitContextAvailable", function() {
        let s : helpers.TestSetup;
        let subject : context.Context;
        beforeEach(function() {
            s = new helpers.TestSetup();
            subject = s.context;
        })

        it("does not attempt to re-generate the bundle if the syskit context is already available", async function() {
            let { mock, ws } = s.createAndRegisterWorkspace('ws');
            s.mockContext.setup(x => x.hasValidSyskitContext(ws)).
                returns(() => Promise.resolve(true))
            let count = 0;
            mock.setup(x => x.syskitGenApp(TypeMoq.It.isAny())).
                returns(() => { count += 1; return Promise.reject("test"); })
            await subject.ensureSyskitContextAvailable(ws);
            assert.equal(0, count);
        })

        it("generates the bundle if the syskit context is not available", async function() {
            let { mock, ws } = s.createAndRegisterWorkspace('ws');
            s.mockContext.setup(x => x.hasValidSyskitContext(ws)).
                returns(() => Promise.resolve(false))
            let count = 0;
            mock.setup(x => x.syskitGenApp(TypeMoq.It.isAny())).
                returns(() => { count += 1; return Promise.resolve(); })
            await subject.ensureSyskitContextAvailable(ws);
            assert.equal(1, count);
        })

        it("rejects if the generation fails", async function() {
            let { mock, ws } = s.createAndRegisterWorkspace('ws');
            s.mockContext.setup(x => x.hasValidSyskitContext(ws)).
                returns(() => Promise.resolve(false))
            mock.setup(x => x.syskitGenApp(TypeMoq.It.isAny())).
                returns(() => Promise.reject(new Error("generation failed")));
            await helpers.assertThrowsAsync(
                subject.ensureSyskitContextAvailable(ws),
                /generation failed/);
        })

        it("returns the same promise until it is resolved or rejected", async function() {
            let { mock, ws } = s.createAndRegisterWorkspace('ws');
            s.mockContext.setup(x => x.hasValidSyskitContext(ws)).
                returns(() => Promise.resolve(false))

            let pResolve;
            let p = new Promise<void>((resolve, reject) => { pResolve = resolve; });
            mock.setup(x => x.syskitGenApp(TypeMoq.It.isAny())).
                returns(() => p);
            let firstP  = subject.ensureSyskitContextAvailable(ws);
            assert.strictEqual(firstP, subject.ensureSyskitContextAvailable(ws));
        })

        it("re-runs a new promise after the previous one was resolved", async function() {
            let { mock, ws } = s.createAndRegisterWorkspace('ws');
            s.mockContext.setup(x => x.hasValidSyskitContext(ws)).
                returns(() => Promise.resolve(false))

            let pResolve;
            let p = new Promise<void>((resolve, reject) => { pResolve = resolve; })
            mock.setup(x => x.syskitGenApp(TypeMoq.It.isAny())).
                returns(() => p);
            let firstP = subject.ensureSyskitContextAvailable(ws);
            pResolve();
            await firstP;
            assert.notStrictEqual(firstP, subject.ensureSyskitContextAvailable(ws));
        })

        it("re-runs a new promise after the previous one was rejected", async function() {
            let { mock, ws } = s.createAndRegisterWorkspace('ws');
            s.mockContext.setup(x => x.hasValidSyskitContext(ws)).
                returns(() => Promise.resolve(false))

            let pReject;
            let p = new Promise<void>((resolve, reject) => { pReject = reject; });
            mock.setup(x => x.syskitGenApp(TypeMoq.It.isAny())).
                returns(() => { console.log("GEN APP"); return p });
            let firstP = subject.ensureSyskitContextAvailable(ws);
            p.catch(() => console.log("P FAILED"));
            pReject(new Error("test"));
            await helpers.assertThrowsAsync(firstP, /test/);
            assert.notStrictEqual(firstP, subject.ensureSyskitContextAvailable(ws));
        })
    })
});
