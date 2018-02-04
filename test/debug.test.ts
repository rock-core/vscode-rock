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
import { basename, join as joinPath } from 'path'

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
    describe("resolveDebugConfiguration", function () {
        it("returns an unchanged configuration", async function () {
            const config: vscode.DebugConfiguration = {
                name: "config",
                type: "cppdbg",
                request: "launch"
            }
            assert.deepEqual(await subject.resolveDebugConfiguration(undefined,
                config, undefined), config);
        })
    })
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
        it("returns undefined if the package is an unsupported type", async function() {
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
        it("can resolve multiple entries in the same string", async function() {
            let expanded = await subject.expandAutoprojPaths((name) => Promise.resolve(`/path/to/${name}`), pkg,
                "before:${rock:which:first}:middle:${rock:which:second}:after")
            assert.equal(expanded, "before:/path/to/first:middle:/path/to/second:after");
        })
    })
    describe("performExpansionsInObject", function() {
        it("expands the values of all the fields", async function() {
            let object = { a: 'a', b: 'b', c: 'c' }
            let result = await subject.performExpansionsInObject(object,
                async (name) => `X:${name}:Y`)
            assert.deepStrictEqual(result, { a: 'X:a:Y', b: 'X:b:Y', c: 'X:c:Y'})
        })
        it("recursively expands objects", async function() {
            let object = { a: 'a', b: { name: 'A', value: 'B' }, c: 'c' }
            let result = await subject.performExpansionsInObject(object,
                async (name) => {
                    if (name[0] == 'A') {
                        return name;
                    }
                    else {
                        return `X:${name}:Y`;
                    }
                })
            let expected = {
                a: 'X:a:Y',
                b: { name: 'A', value: 'X:B:Y' },
                c: 'X:c:Y'
            }
            assert.deepStrictEqual(result, expected);
        })
        it("recursively expands arrays", async function() {
            let object = { a: 'a', b: ['B', 'C' ], c: 'c' }
            let result = await subject.performExpansionsInObject(object,
                async (name) => {
                    if (name[0] == 'A') {
                        return name;
                    }
                    else {
                        return `X:${name}:Y`;
                    }
                })
            let expected = {
                a: 'X:a:Y',
                b: ['X:B:Y', 'X:C:Y'],
                c: 'X:c:Y'
            }
            assert.deepStrictEqual(result, expected);
        })
        it("recursively expands objects within arrays", async function() {
            let object = { a: 'a', b: [{ name: 'A', value: 'B' }, { name: 'A', value: 'C' }], c: 'c' }
            let result = await subject.performExpansionsInObject(object,
                async (name) => {
                    if (name[0] == 'A') {
                        return name;
                    }
                    else {
                        return `X:${name}:Y`;
                    }
                })
            let expected = {
                a: 'X:a:Y',
                b: [
                    { name: 'A', value: 'X:B:Y' },
                    { name: 'A', value: 'X:C:Y' }
                ],
                c: 'X:c:Y'
            }
            assert.deepStrictEqual(result, expected);
        })
    })
})

describe("CXXConfigurationProvider", function() {
    let subject: debug.CXXConfigurationProvider;
    let root: string;
    let s: helpers.TestSetup;
    let folder: vscode.WorkspaceFolder;
    beforeEach(function() {
        root = helpers.init();
        s = new helpers.TestSetup();
        subject = new debug.CXXConfigurationProvider(s.context);
        folder = {
            name: "folder",
            uri: vscode.Uri.file("/path/to/folder"),
            index: 0
        }
    })
    afterEach(function () {
        helpers.clear();
    });
    describe("resolveDebugConfiguration", function () {
        describe("the package could not be resolved", function () {
            let mockSubject: TypeMoq.IMock<debug.CXXConfigurationProvider>;
            beforeEach(function() {
                mockSubject = TypeMoq.Mock.ofInstance(subject);
                mockSubject.setup(x => x.resolvePackage(TypeMoq.It.isAny())).
                    returns(() => Promise.resolve(undefined));
                subject = mockSubject.target;
            })
            it("returns an unchanged configuration", async function () {
                const config: vscode.DebugConfiguration = {
                    name: "config",
                    type: "cppdbg",
                    request: "launch"
                }
                assert.deepEqual(await subject.resolveDebugConfiguration(folder,
                    config, undefined), config);
            })
        })
        describe("the package is resolved to a RockPackage", function () {
            let mock: TypeMoq.IMock<autoproj.Workspace>;
            let ws: autoproj.Workspace;
            let pkg: packages.Package;
            let config: vscode.DebugConfiguration;
            let stub: string;
            beforeEach(async function() {
                let result = s.createAndRegisterWorkspace('test');
                ws = result.ws;
                pkg = await s.registerPackage(ws, ['test'], { type: 'Autobuild::CMake' });
                folder = {
                    uri: vscode.Uri.file(pkg.path),
                    name: "package",
                    index: 0
                };
                config = {
                    name: "config",
                    type: "cppdbg",
                    request: "launch",
                    miDebuggerPath: "/path/to/gdb",
                    MIMode: "gdb",
                    program: "/path/to/target"
                }
                stub = joinPath(__dirname, '..', '..', 'stubs', config.MIMode);
            })
            it("preserves the given environment", async function () {
                config.environment = [ { name: "TEST", value: "FOO" }];
                let resolvedConfig = await subject.resolveDebugConfiguration(folder,
                    config, undefined);
                let envItem = (resolvedConfig.environment as Array<any>).
                    find((item) => item.name == "TEST");
                assert.equal(envItem.value, "FOO");
            })
            it("replaces miDebuggerPath with the stub script", async function () {
                let resolvedConfig = await subject.resolveDebugConfiguration(folder,
                    config, undefined);

                assert.equal(resolvedConfig.miDebuggerPath, stub);
                let envItem = (resolvedConfig.environment as Array<any>).
                    find((item) => item.name == "VSCODE_ROCK_AUTOPROJ_DEBUGGER");
                assert.equal(envItem.value, "/path/to/gdb");
            })
            it("sets miDebuggerPath to the stub script", async function () {
                config.miDebuggerPath = undefined;
                let resolvedConfig = await subject.resolveDebugConfiguration(folder,
                    config, undefined);

                assert.equal(resolvedConfig.miDebuggerPath, stub);
                let envItem = (resolvedConfig.environment as Array<any>).
                    find((item) => item.name == "VSCODE_ROCK_AUTOPROJ_DEBUGGER");
                assert.equal(envItem.value, "gdb");
            })
            it("sets autoproj executable path", async function () {
                let resolvedConfig = await subject.resolveDebugConfiguration(folder,
                    config, undefined);
                let envItem = (resolvedConfig.environment as Array<any>).
                    find((item) => item.name == "VSCODE_ROCK_AUTOPROJ_PATH");
                assert.equal(envItem.value, ws.autoprojExePath());
            })
            it("sets autoproj current root", async function () {
                let resolvedConfig = await subject.resolveDebugConfiguration(folder,
                    config, undefined);
                let envItem = (resolvedConfig.environment as Array<any>).
                    find((item) => item.name == "AUTOPROJ_CURRENT_ROOT");
                assert.equal(envItem.value, ws.root);
            })
            it("expands the 'program' value", async function () {
                let mockSubject = TypeMoq.Mock.ofInstance(subject);
                mockSubject.setup(x => x.expandAutoprojPaths(TypeMoq.It.isAny(),
                    (pkg as packages.RockPackage).info, config.program)).
                    returns(() => Promise.resolve("expanded"));
                subject = mockSubject.target;

                let resolvedConfig = await subject.resolveDebugConfiguration(folder,
                    config, undefined);
                assert.equal(resolvedConfig.program, "expanded");
            })
            it("expands the 'cwd' value", async function () {
                let mockSubject = TypeMoq.Mock.ofInstance(subject);
                mockSubject.setup(x => x.expandAutoprojPaths(TypeMoq.It.isAny(),
                    (pkg as packages.RockPackage).info, config.cwd)).
                    returns(() => Promise.resolve("expanded"));
                subject = mockSubject.target;
                config.cwd = "/path/to/cwd"

                let resolvedConfig = await subject.resolveDebugConfiguration(folder,
                    config, undefined);
                assert.equal(resolvedConfig.cwd, "expanded");
            })
        })
    })
})


describe("RubyConfigurationProvider", function() {
    let subject: debug.RubyConfigurationProvider;
    let root: string;
    let s: helpers.TestSetup;
    let folder: vscode.WorkspaceFolder;
    beforeEach(function() {
        root = helpers.init();
        s = new helpers.TestSetup();
        subject = new debug.RubyConfigurationProvider(s.context);
        folder = {
            name: "folder",
            uri: vscode.Uri.file("/path/to/folder"),
            index: 0
        }
    })
    afterEach(function () {
        helpers.clear();
    });
    describe("resolveDebugConfiguration", function () {
        describe("the package could not be resolved", function () {
            let mockSubject: TypeMoq.IMock<debug.RubyConfigurationProvider>;
            beforeEach(function() {
                mockSubject = TypeMoq.Mock.ofInstance(subject);
                mockSubject.setup(x => x.resolvePackage(TypeMoq.It.isAny())).
                    returns(() => Promise.resolve(undefined));
                subject = mockSubject.target;
            })
            it("returns an unchanged configuration", async function () {
                const config: vscode.DebugConfiguration = {
                    name: "config",
                    type: "cppdbg",
                    request: "launch"
                }
                assert.deepEqual(await subject.resolveDebugConfiguration(folder,
                    config, undefined), config);
            })
        })
        describe("the package is resolved to a RockPackage", function () {
            let mock: TypeMoq.IMock<autoproj.Workspace>;
            let ws: autoproj.Workspace;
            let pkg: packages.Package;
            let config: vscode.DebugConfiguration;
            beforeEach(async function() {
                let result = s.createAndRegisterWorkspace('test');
                ws = result.ws;
                pkg = await s.registerPackage(ws, ['test'], { type: 'Autobuild::Ruby' });
                folder = {
                    uri: vscode.Uri.file(pkg.path),
                    name: "package",
                    index: 0
                };
                config = {
                    name: "config",
                    type: "Ruby",
                    request: "launch",
                    useBundler: false,
                    program: "/path/to/target"
                }
            })
            it("preserves the given environment", async function () {
                config.env = { TEST: "FOO" };
                let resolvedConfig = await subject.resolveDebugConfiguration(folder,
                    config, undefined);
                assert.equal(resolvedConfig.env.TEST, "FOO");
            })
            it("sets useBundler to true", async function () {
                let resolvedConfig = await subject.resolveDebugConfiguration(folder,
                    config, undefined);
                assert.equal(resolvedConfig.useBundler, true);
            })
            it("sets pathToBundler to autoproj's executable", async function () {
                let resolvedConfig = await subject.resolveDebugConfiguration(folder,
                    config, undefined);
                assert.equal(resolvedConfig.pathToBundler, ws.autoprojExePath());
            })
            it("sets autoproj current root", async function () {
                let resolvedConfig = await subject.resolveDebugConfiguration(folder,
                    config, undefined);
                assert.equal(resolvedConfig.env.AUTOPROJ_CURRENT_ROOT, ws.root);
            })
            it("expands the 'program' value", async function () {
                let mockSubject = TypeMoq.Mock.ofInstance(subject);
                mockSubject.setup(x => x.expandAutoprojPaths(TypeMoq.It.isAny(),
                    (pkg as packages.RockPackage).info, config.program)).
                    returns(() => Promise.resolve("expanded"));
                subject = mockSubject.target;

                let resolvedConfig = await subject.resolveDebugConfiguration(folder,
                    config, undefined);
                assert.equal(resolvedConfig.program, "expanded");
            })
            it("expands the 'cwd' value", async function () {
                let mockSubject = TypeMoq.Mock.ofInstance(subject);
                mockSubject.setup(x => x.expandAutoprojPaths(TypeMoq.It.isAny(),
                    (pkg as packages.RockPackage).info, config.cwd)).
                    returns(() => Promise.resolve("expanded"));
                subject = mockSubject.target;
                config.cwd = "/path/to/cwd"

                let resolvedConfig = await subject.resolveDebugConfiguration(folder,
                    config, undefined);
                assert.equal(resolvedConfig.cwd, "expanded");
            })
        })
    })
})