import * as assert from 'assert'
import * as TypeMoq from 'typemoq'
import * as debug from '../src/debug'
import * as wrappers from '../src/wrappers'
import * as context from '../src/context'
import * as vscode from 'vscode'
import * as autoproj from '../src/autoproj'
import * as helpers from './helpers'
import * as path from 'path'
import * as packages from '../src/packages'
import { basename } from 'path'
import { EnvironmentBridge } from '../src/async';

describe("ConfigurationProvider", function() {
    let root: string;
    let s: helpers.TestSetup;
    let subject: debug.ConfigurationProvider;
    let mock;
    let ws;
    beforeEach(function() {
        root = helpers.init();
        s = new helpers.TestSetup();
        subject = new debug.ConfigurationProvider(s.context);
        let result = s.createAndRegisterWorkspace('test');
        ws = result.ws;
    })
    afterEach(function () {
        helpers.clear();
    });
    describe("resolvePackage", function() {
        it("returns undefined for an undefined workspace folder", async function() {
            let pkg = await subject.resolvePackage(undefined)
            assert.strictEqual(pkg, undefined);
        })
        it("returns the package if it is a RockPackage", async function() {
            let pkg = await s.registerPackage(ws, ['test'], { type: 'Autobuild::CMake' })
            let folder: vscode.WorkspaceFolder = {
                uri: vscode.Uri.file(pkg.path),
                name: "package",
                index: 0
            };
            let resolved = await subject.resolvePackage(folder);
            assert.deepStrictEqual(resolved, pkg);
        })
        it("returns undefined if the package is not a RockPackage", async function() {
            let pkg = await s.registerPackage(ws, ['test'], { type: '' })
            let folder: vscode.WorkspaceFolder = {
                uri: vscode.Uri.file(pkg.path),
                name: "package",
                index: 0
            };
            let resolved = await subject.resolvePackage(folder);
            assert.strictEqual(resolved, undefined);
        })
    })
    describe("expandAutoprojPaths", function() {
        let pkg = {
            srcdir: "/path/to/src",
            builddir: "/path/to/build",
            prefix: "/path/to/prefix"
        }
        it("replaces the srcdir", async function() {
            let expanded = await subject.expandAutoprojPaths((name) => Promise.resolve(""), pkg, "before:${rock:srcDir}:after")
            assert.equal("before:/path/to/src:after", expanded);
        })
        it("replaces the builddir", async function() {
            let expanded = await subject.expandAutoprojPaths((name) => Promise.resolve(""), pkg, "before:${rock:buildDir}:after")
            assert.equal("before:/path/to/build:after", expanded);
        })
        it("replaces the prefix", async function() {
            let expanded = await subject.expandAutoprojPaths((name) => Promise.resolve(""), pkg, "before:${rock:prefixDir}:after")
            assert.equal("before:/path/to/prefix:after", expanded);
        })
        it("resolves a command using 'which'", async function() {
            let expanded = await subject.expandAutoprojPaths((name) => Promise.resolve(`/path/to/${name}`), pkg, "before:${rock:which:test}:after")
            assert.equal("before:/path/to/test:after", expanded);
        })
    })
})