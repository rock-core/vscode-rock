'use strict';
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as autoproj from '../autoproj';
import * as helpers from './helpers';
import * as TypeMoq from 'typemoq'
import * as events from 'events';

describe("Autoproj helpers tests", function () {
    let root: string;
    beforeEach(function () {
        root = helpers.init();
    })
    afterEach(function () {
        helpers.clear();
    })

    describe("findWorkspaceRoot", function() {
        it("finds the workspace when given the root", function () {
            helpers.mkdir('.autoproj');
            helpers.createInstallationManifest([]);
            assert.equal(root, autoproj.findWorkspaceRoot(root));
        });
        it("finds the workspace root if given a subdirectory within it", function () {
            helpers.mkdir('.autoproj');
            helpers.createInstallationManifest([]);
            helpers.mkdir('a');
            let dir = helpers.mkdir('a', 'b');
            assert.equal(root, autoproj.findWorkspaceRoot(dir));
        });
        it("returns null if not in a workspace", function () {
            helpers.mkdir('.autoproj');
            assert.equal(null, autoproj.findWorkspaceRoot(root));
        });
    })

    const MANIFEST_TEST_FILE = `
- package_set: orocos.toolchain
  vcs:
    type: git
    url: https://github.com/orocos-toolchain/autoproj.git
    repository_id: github:/orocos-toolchain/autoproj.git
  raw_local_dir: raw/pkg/set/dir
  user_local_dir: user/pkg/set/dir
- name: tools/rest_api
  type: Autobuild::Ruby
  vcs:
    type: git
    url: https://github.com/rock-core/tools-rest_api.git
    repository_id: github:/rock-core/tools-rest_api.git
  srcdir: "/path/to/tools/rest_api"
  builddir: 
  logdir: "/path/to/install/tools/rest_api/log"
  prefix: "/path/to/install/tools/rest_api"
  dependencies:
  - utilrb
  - tools/orocos.rb
`
    const PKG_SET_OROCOS_TOOLCHAIN = {
        name: "orocos.toolchain",
        vcs: {
            type: 'git',
            url: 'https://github.com/orocos-toolchain/autoproj.git',
            repository_id: 'github:/orocos-toolchain/autoproj.git'
        },
        raw_local_dir: 'raw/pkg/set/dir',
        user_local_dir: 'user/pkg/set/dir'
    }

    const PKG_TOOLS_REST_API = {
        name: 'tools/rest_api',
        type: 'Autobuild::Ruby',
        vcs: {
            type: 'git',
            url: 'https://github.com/rock-core/tools-rest_api.git',
            repository_id: 'github:/rock-core/tools-rest_api.git'
        },
        srcdir: "/path/to/tools/rest_api",
        builddir: null,
        logdir: "/path/to/install/tools/rest_api/log",
        prefix: "/path/to/install/tools/rest_api",
        dependencies: ['utilrb', 'tools/orocos.rb']
    }

    describe("loadWorkspaceInfo", function() {
        it("parses the manifest and returns it", function() {
            helpers.mkdir('.autoproj');
            helpers.mkfile(MANIFEST_TEST_FILE, ".autoproj", "installation-manifest");
            return autoproj.loadWorkspaceInfo(root).then(function (manifest) {
                assert.deepStrictEqual(manifest.packageSets.get('user/pkg/set/dir'), PKG_SET_OROCOS_TOOLCHAIN);
                assert.deepStrictEqual(manifest.packages.get('/path/to/tools/rest_api'), PKG_TOOLS_REST_API);
            })
        })
        it("parses an empty manifest", function() {
            helpers.mkdir('.autoproj');
            helpers.mkfile('', ".autoproj", "installation-manifest");
            return autoproj.loadWorkspaceInfo(root).then(function (manifest) {
                assert.equal(manifest.path, root);
                assert.equal(0, manifest.packages.size);
                assert.equal(0, manifest.packages.size);
            })
        })
    })

    describe("Workspace", function() {
        describe("constructor", function() {
            it("starts the info loading by default", function() {
                helpers.mkdir('.autoproj');
                helpers.createInstallationManifest([]);
                let ws = new autoproj.Workspace("path");
                assert(ws.loadingInfo());
            })
            it("does not start the info loading if the loadInfo flag is false", function() {
                let ws = new autoproj.Workspace("path", false);
                assert(!ws.loadingInfo());
            })
        })
        describe("fromDir", function() {
            it("returns null when called outside a workspace", function() {
                helpers.mkdir('.autoproj');
                assert.equal(null, autoproj.Workspace.fromDir(root));
            })
            it("returns a Workspace object when called within a workspace", function() {
                helpers.mkdir('.autoproj');
                helpers.createInstallationManifest([]);
                assert(autoproj.Workspace.fromDir(root) instanceof autoproj.Workspace);
            })
            it("sets the workspace name using the folder's basename", function() {
                helpers.mkdir('.autoproj');
                helpers.createInstallationManifest([]);
                let ws = autoproj.Workspace.fromDir(root) as autoproj.Workspace;
                assert.equal(path.basename(root), ws.name);
            })
        })
        describe("info", function() {
            it("returns a promise that gives access to the info", function() {
                helpers.mkdir('.autoproj');
                helpers.mkfile(MANIFEST_TEST_FILE, ".autoproj", "installation-manifest");
                let ws = autoproj.Workspace.fromDir(root) as autoproj.Workspace;
                return ws.info().then(function (manifest) {
                    assert.deepStrictEqual(manifest.packageSets.get('user/pkg/set/dir'), PKG_SET_OROCOS_TOOLCHAIN);
                    assert.deepStrictEqual(manifest.packages.get('/path/to/tools/rest_api'), PKG_TOOLS_REST_API);
                })
            })
            it("creates and returns the promise if the constructor was not instructed to load it", function() {
                helpers.mkdir('.autoproj');
                helpers.mkfile(MANIFEST_TEST_FILE, ".autoproj", "installation-manifest");
                let ws = autoproj.Workspace.fromDir(root, false) as autoproj.Workspace;
                return ws.info().then(function (manifest) {
                    assert.deepStrictEqual(manifest.packageSets.get('user/pkg/set/dir'), PKG_SET_OROCOS_TOOLCHAIN);
                    assert.deepStrictEqual(manifest.packages.get('/path/to/tools/rest_api'), PKG_TOOLS_REST_API);
                })
            })
            it("does not re-resolve the info on each call", async function() {
                helpers.mkdir('.autoproj');
                helpers.mkfile(MANIFEST_TEST_FILE, ".autoproj", "installation-manifest");
                let workspace = autoproj.Workspace.fromDir(root, false) as autoproj.Workspace;
                let promise = await workspace.info();
                let promise2 = await workspace.info();
                assert.equal(promise, promise2);
            })
            it("reloads the information on reload()", async function() {
                helpers.mkdir('.autoproj');
                helpers.mkfile(MANIFEST_TEST_FILE, ".autoproj", "installation-manifest");
                let workspace = autoproj.Workspace.fromDir(root, false) as autoproj.Workspace;
                let initial  = await workspace.info()
                let reloaded = await workspace.reload();
                assert.notEqual(reloaded, initial);
                assert.equal(reloaded, await workspace.info());
            })
        })

        describe("envsh", function() {
            let processMock   = new events.EventEmitter();
            let originalSpawn = require('child_process').spawn;
            let subjectMock;
            let subject;
            let originalInfo;

            beforeEach(async function() {
                let spawn = function (...args) { return processMock };
                require('child_process').spawn = spawn;

                helpers.mkdir('.autoproj');
                helpers.mkfile(MANIFEST_TEST_FILE, ".autoproj", "installation-manifest");
                let ws = autoproj.Workspace.fromDir(root, false) as autoproj.Workspace;
                originalInfo = await ws.info();
                subjectMock = TypeMoq.Mock.ofInstance(ws);
                subjectMock.callBase = true;
                subject = subjectMock.object;
            })
            afterEach(function() {
                require('child_process').spawn = originalSpawn;
            })

            it("reloads the information on success", async function() {
                let p = subject.envsh();
                processMock.emit('exit', 0, null);
                let resolvedInfo = await p;
                subjectMock.verify(x => x.reload(), TypeMoq.Times.once());
                assert.notEqual(resolvedInfo, originalInfo);
            })

            it("returns the known information on failure", async function() {
                let p = subject.envsh();
                processMock.emit('exit', 1, null);
                let resolvedInfo = await p;
                subjectMock.verify(x => x.info(), TypeMoq.Times.once());
                assert.equal(resolvedInfo, originalInfo);
            })

            it("returns the known information on signal", async function() {
                let p = subject.envsh();
                processMock.emit('exit', null, 5);
                let resolvedInfo = await p;
                subjectMock.verify(x => x.info(), TypeMoq.Times.once());
                assert.equal(resolvedInfo, originalInfo);
            })
        })

        describe("which", function() {
            let stdoutMock   = new events.EventEmitter();
            let processMock: { [key: string]: any } = new events.EventEmitter();
            let originalSpawn = require('child_process').spawn;
            let subjectMock;
            let subject;
            let originalInfo;

            beforeEach(async function() {
                processMock.stdout = stdoutMock;
                let spawn = function (...args) { return processMock };
                require('child_process').spawn = spawn;

                helpers.mkdir('.autoproj');
                helpers.mkfile(MANIFEST_TEST_FILE, ".autoproj", "installation-manifest");
                let ws = autoproj.Workspace.fromDir(root, false) as autoproj.Workspace;
                subjectMock = TypeMoq.Mock.ofInstance(ws);
                subjectMock.callBase = true;
                subject = subjectMock.object;
            })
            afterEach(function() {
                require('child_process').spawn = originalSpawn;
            })

            it("returns the path displayed by autoproj on success", async function() {
                let p = subject.which('cmd');
                stdoutMock.emit('data', '/test/cmd\n');
                processMock.emit('exit', 0, null);
                assert.equal("/test/cmd", await p);
            })

            it("concatenates the data if received in chunks", async function() {
                let p = subject.which('cmd');
                stdoutMock.emit('data', '/te');
                stdoutMock.emit('data', 'st/cmd\n');
                processMock.emit('exit', 0, null);
                assert.equal("/test/cmd", await p);
            })

            it("rejects the promise on failure", async function() {
                helpers.assertThrowsAsync(async () => subject.which('cmd'),
                    /cannot find cmd in the workspace/)
            })
        })
    })
    describe("Workspaces", function () {
        let workspaces;

        beforeEach(function () {
            this.workspaces = new autoproj.Workspaces();
        })

        describe("add", function() {
            it ("leaves the workspace name alone if no devFolder has been given", function() {
                helpers.mkdir('.autoproj');
                helpers.createInstallationManifest([]);
                let ws = autoproj.Workspace.fromDir(root) as autoproj.Workspace;
                ws.name = 'test';
                this.workspaces.add(ws);
                assert.equal('test', ws.name);
            })
            it ("sets the workspace name if devFolder is set", function() {
                this.workspaces.devFolder = root
                let dir = helpers.mkdir('a');
                helpers.createInstallationManifest([], 'a')
                let ws = autoproj.Workspace.fromDir(dir) as autoproj.Workspace;
                ws.name = 'test';
                this.workspaces.add(ws);
                assert.equal('a', ws.name);
            })
        })

        describe("addFolder", function () {
            it("does not add a folder that is not within an Autoproj workspace", function() {
                let dir = helpers.mkdir('a', 'b');
                let workspace = this.workspaces.addFolder(dir);
                assert(!workspace);
            })
            it("adds folders that are within a workspace", function() {
                helpers.mkdir('.autoproj');
                helpers.createInstallationManifest([]);
                let dir = helpers.mkdir('a', 'b');
                let workspace = this.workspaces.addFolder(dir);
                assert.equal(workspace.root, root);
                assert.equal(1, this.workspaces.useCount(workspace));
            })
            it("adds the same workspace only once", function() {
                helpers.mkdir('.autoproj');
                helpers.createInstallationManifest([]);
                let a = helpers.mkdir('a');
                let wsA = this.workspaces.addFolder(a)
                let b = helpers.mkdir('a', 'b');
                let wsB = this.workspaces.addFolder(b)
                assert.equal(wsA, wsB);
                assert.equal(2, this.workspaces.useCount(wsB));
            })
        })

        describe("deleteFolder", function () {
            it("does nothing for a folder that is not registered", function() {
                let dir = helpers.mkdir('a', 'b');
                assert(!this.workspaces.deleteFolder(dir));
            })
            it("removes a registered folder", function() {
                helpers.mkdir('.autoproj');
                helpers.createInstallationManifest([]);
                let dir = helpers.mkdir('a', 'b');
                let workspace = this.workspaces.addFolder(dir);
                assert(this.workspaces.deleteFolder(dir));
                assert.equal(0, this.workspaces.useCount(workspace));
            })
            it("keeps a workspace until all the corresponding folders have been removed", function() {
                helpers.mkdir('.autoproj');
                helpers.createInstallationManifest([]);
                let a = helpers.mkdir('a');
                let ws = this.workspaces.addFolder(a)
                let b = helpers.mkdir('a', 'b');
                this.workspaces.addFolder(b)
                this.workspaces.deleteFolder(b)
                assert.equal(1, this.workspaces.useCount(ws));
                this.workspaces.deleteFolder(a)
                assert.equal(0, this.workspaces.useCount(ws));
            })
        })
        describe("isConfig", function () {
            beforeEach(function () {
                helpers.mkdir('one');
                helpers.mkdir('two');
                helpers.mkdir('one', '.autoproj');
                helpers.mkdir('two', '.autoproj');
                helpers.createInstallationManifest([], 'one');
                helpers.createInstallationManifest([], 'two');
            })
            it("returns true if the folder is a child of the workspace configuration", function() {
                let a = helpers.mkdir('one', 'autoproj');
                let b = helpers.mkdir('one', 'autoproj', 'overrides.d');
                let c = helpers.mkdir('two', '.autoproj', 'remotes');
                let ws = this.workspaces.addFolder(a);
                this.workspaces.addFolder(b);
                this.workspaces.addFolder(c);
                assert.equal(this.workspaces.isConfig(a), true);
                assert.equal(this.workspaces.isConfig(b), true);
                assert.equal(this.workspaces.isConfig(c), true);
            })
            it("returns false if the folder is not part of the workspace configuration", function() {
                let a = helpers.mkdir('one', 'a');
                let b = helpers.mkdir('one', 'b');
                let c = helpers.mkdir('two', 'c');
                let ws = this.workspaces.addFolder(a);
                this.workspaces.addFolder(b);
                this.workspaces.addFolder(c);
                assert.equal(this.workspaces.isConfig(a), false);
                assert.equal(this.workspaces.isConfig(b), false);
                assert.equal(this.workspaces.isConfig(c), false);
            })
        })
    })
});