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