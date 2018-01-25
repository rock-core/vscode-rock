'use strict'
import * as typemoq from 'typemoq';
import { Connection } from '../src/syskit'
import * as autoproj from '../src/autoproj'
import * as helpers from './helpers'
import * as vscode from 'vscode';

describe("SyskitConnection", function() {
    let s : helpers.TestSetup;
    let root : string;
    let mockSyskit : typemoq.IMock<Connection>;
    let syskit : Connection;
    let mockWorkspace : typemoq.IMock<autoproj.Workspace>;
    let workspace : autoproj.Workspace;

    beforeEach(function () {
        s = new helpers.TestSetup();
        root = helpers.init();
        let { mock, ws } = s.createAndRegisterWorkspace('ws');
        mockWorkspace = mock;
        workspace = ws;
        mockSyskit = typemoq.Mock.ofType2(Connection, [s.context, workspace, s.wrapper]);
        syskit = mockSyskit.target;
    })

    afterEach(function() {
        helpers.clear();
    })

    describe("connect", function() {
        let tokenSource : vscode.CancellationTokenSource;
        beforeEach(function () {
            tokenSource = new vscode.CancellationTokenSource()
        })
        afterEach(function () {
            tokenSource.dispose();
        })
        it("attempts connection until the connection attempt succeeds", async function() {
            let syskit_run_resolve;
            let syskit_run = new Promise((resolve, reject) => syskit_run_resolve = resolve);
            s.mockWrapper.setup(x => x.runTask(`rock - syskit run ${workspace.root}`)).
                returns(() => syskit_run)
            mockSyskit.setup(x => x.attemptConnection()).
                returns(() => Promise.resolve(true));
            await syskit.connect(tokenSource.token);
        })
        it("fails if cancellation is requested", async function () {
            let p = syskit.connect(tokenSource.token);
            tokenSource.cancel();
            await helpers.assertThrowsAsync(p, /Cancelled connection to Syskit/);
        })
    })
})