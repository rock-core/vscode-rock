import * as assert from 'assert'
import * as TypeMoq from 'typemoq'
import * as debug from '../debug'
import * as wrappers from '../wrappers'
import * as context from '../context'
import * as vscode from 'vscode'

describe("Target", function () {
    let subject: debug.Target;
    beforeEach(function () {
        subject = new debug.Target('test', '/path/to/some/test');
    })
    it("returns the target name", function () {
        assert.equal(subject.name, 'test');
    })
    it("returns the target path", function () {
        assert.equal(subject.path, '/path/to/some/test');
    })
})

describe("TargetPickerFactory", function () {
    let subject: debug.TargetPickerFactory;
    let mockContext: TypeMoq.IMock<wrappers.VSCode>;
    beforeEach(function () {
        mockContext = TypeMoq.Mock.ofType<wrappers.VSCode>();
        subject = new debug.TargetPickerFactory(mockContext.object);
    })
    describe("createFactory", function () {
        it("returns a target picker for a cxx package", function () {
            const picker = subject.createPicker(context.PackageTypeList.CXX);
            assert.notEqual(picker, undefined);
        })
        it("returns undefined for other packages", function () {
            const picker = subject.createPicker(context.PackageTypeList.OTHER);
            assert.equal(picker, undefined);
        })
    })
})

describe("GenericTargetPicker", function () {
    let subject: debug.GenericTargetPicker;
    let mockContext: TypeMoq.IMock<wrappers.VSCode>;
    beforeEach(function () {
        mockContext = TypeMoq.Mock.ofType<wrappers.VSCode>();
        subject = new debug.GenericTargetPicker(mockContext.object, '/path/to/something');
    })
    describe("show", function () {
        it("shows an open dialog and returns the picked file", async function () {
            const options: vscode.OpenDialogOptions = {
                canSelectMany: false,
                canSelectFiles: true,
                canSelectFolders: false,
                defaultUri: vscode.Uri.file('/path/to/something')
            };

            const uri = new Promise<Array<vscode.Uri>>((resolve) => {
                const data = [ vscode.Uri.file('/a/picked/file') ];
                resolve(data);
            })
            mockContext.setup(x => x.showOpenDialog(options)).returns(() => uri);
            const target = await subject.show();
            assert.equal(target.name, 'file');
            assert.equal(target.path, '/a/picked/file');
            assert.equal(subject.target.name, 'file');
            assert.equal(subject.target.path, '/a/picked/file');
        })
        it("shows an open dialog and returns undefned", async function () {
            mockContext.setup(x => x.showOpenDialog(TypeMoq.It.isAny())).returns(() => undefined);
            const target = await subject.show();
            assert.equal(target, undefined);
            assert.equal(subject.target, undefined);
        })
    })
})

describe("ConfigurationProvider", function () {
    let subject: debug.ConfigurationProvider;
    beforeEach(function () {
        subject = new debug.ConfigurationProvider();
    })
    describe("configuration", function () {
        it("returns a debugging configuration for a cxx package", async function () {
            const target = new debug.Target('package', '/path/to/package/build/test');
            const type = context.PackageTypeList.CXX;
            const cwd = '/path/to/package';

            const options = await subject.configuration(target, type, cwd);
            const expected = {
                type: "cppdbg",
                name: "rock debug",
                request: "launch",
                program: target.path,
                externalConsole: false,
                MIMode: "gdb",
                cwd: cwd,
                setupCommands: [
                    {
                        description: "Enable pretty-printing for gdb",
                        text: "-enable-pretty-printing",
                        ignoreFailures: false
                    }
                ]
            };
            assert.deepEqual(options, expected);
        })
        it("returns a debugging configuration for a ruby package", async function () {
            const target = new debug.Target('package', '/path/to/package/build/test');
            const type = context.PackageTypeList.RUBY;
            const cwd = '/path/to/package';

            const options = await subject.configuration(target, type, cwd);
            const expected = {
                type: "Ruby",
                name: "rock debug",
                request: "launch",
                program: target.path,
                cwd: cwd,
            };
            assert.equal(options.type, expected.type);
            assert.equal(options.name, expected.name);
            assert.equal(options.request, expected.request);
            assert.equal(options.program, expected.program);
            assert.equal(options.cwd, expected.cwd);
        })
        it("returns undefined for other packages", function () {
            const target = new debug.Target('package', '/path/to/package/build/test');
            const type = context.PackageTypeList.OTHER;
            const cwd = '/path/to/package';
            const options = subject.configuration(target, type, cwd);
            assert.equal(options, undefined);
        })
    })
})
