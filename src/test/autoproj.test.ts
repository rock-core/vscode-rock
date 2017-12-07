//
// Note: This example test is leveraging the Mocha test framework.
// Please refer to their documentation on https://mochajs.org/ for help.
//

// The module 'assert' provides assertion methods from node
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import * as autoproj from '../autoproj';

import * as helpers from './helpers';

// Defines a Mocha test suite to group tests of similar kind together
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
  srcdir: "/home/doudou/dev/heads/tools/rest_api"
  builddir: 
  logdir: "/home/doudou/dev/build_area/heads/install/tools/rest_api/log"
  prefix: "/home/doudou/dev/heads/tools/rest_api"
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
        srcdir: "/home/doudou/dev/heads/tools/rest_api",
        builddir: null,
        logdir: "/home/doudou/dev/build_area/heads/install/tools/rest_api/log",
        prefix: "/home/doudou/dev/heads/tools/rest_api",
        dependencies: ['utilrb', 'tools/orocos.rb']
    }

    describe("loadWorkspaceInfo", function() {
        it("parses the manifest and returns it", function() {
            helpers.mkdir('.autoproj');
            helpers.mkfile(MANIFEST_TEST_FILE, ".autoproj", "installation-manifest");
            return autoproj.loadWorkspaceInfo(root).then(function (manifest) {
                assert.deepStrictEqual(manifest.packageSets.get('orocos.toolchain'), PKG_SET_OROCOS_TOOLCHAIN);
                assert.deepStrictEqual(manifest.packages.get('tools/rest_api'), PKG_TOOLS_REST_API);
            })
        })
    })

    describe("Workspace", function() {
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
        })
        describe("info", function() {
            it("returns a promise that gives access to the info", function() {
                helpers.mkdir('.autoproj');
                helpers.mkfile(MANIFEST_TEST_FILE, ".autoproj", "installation-manifest");
                return autoproj.Workspace.fromDir(root).info().then(function (manifest) {
                    assert.deepStrictEqual(manifest.packageSets.get('orocos.toolchain'), PKG_SET_OROCOS_TOOLCHAIN);
                    assert.deepStrictEqual(manifest.packages.get('tools/rest_api'), PKG_TOOLS_REST_API);
                })
            })
            it("creates and returns the promise if the constructor was not instructed to load it", function() {
                helpers.mkdir('.autoproj');
                helpers.mkfile(MANIFEST_TEST_FILE, ".autoproj", "installation-manifest");
                return autoproj.Workspace.fromDir(root, false).info().then(function (manifest) {
                    assert.deepStrictEqual(manifest.packageSets.get('orocos.toolchain'), PKG_SET_OROCOS_TOOLCHAIN);
                    assert.deepStrictEqual(manifest.packages.get('tools/rest_api'), PKG_TOOLS_REST_API);
                })
            })
            it("returns always the same promise", function() {
                helpers.mkdir('.autoproj');
                helpers.mkfile(MANIFEST_TEST_FILE, ".autoproj", "installation-manifest");
                let workspace = autoproj.Workspace.fromDir(root, false)
                let promise = workspace.info()
                assert.equal(promise, workspace.info());
            })
            it("creates a new promise on reload()", function() {
                helpers.mkdir('.autoproj');
                helpers.mkfile(MANIFEST_TEST_FILE, ".autoproj", "installation-manifest");
                let workspace = autoproj.Workspace.fromDir(root, false)
                let initial = workspace.info()
                let reloaded = workspace.reload();
                assert.notEqual(reloaded, initial);
                assert.equal(reloaded, workspace.info());
            })
        })
    })
});