'use strict'
import * as typemoq from 'typemoq';
import * as syskit from '../src/syskit'
import * as autoproj from '../src/autoproj'
import * as helpers from './helpers'
import * as vscode from 'vscode';
import * as assert from 'assert';
import { EventEmitter } from 'events';

describe("SyskitConnection", function() {
    let s : helpers.TestSetup;
    let root : string;
    let mockSyskit : typemoq.IMock<syskit.Connection>;
    let syskitConnection : syskit.Connection;
    let mockWorkspace : typemoq.IMock<autoproj.Workspace>;
    let workspace : autoproj.Workspace;
    let clientMock : typemoq.IMock<syskit.Client>;
    let client : syskit.Client;

    beforeEach(function () {
        s = new helpers.TestSetup();
        root = helpers.init();
        let { mock, ws } = s.createAndRegisterWorkspace('ws');
        mockWorkspace = mock;
        workspace = ws;
        clientMock = typemoq.Mock.ofType<syskit.Client>(undefined, typemoq.MockBehavior.Strict);
        client = clientMock.object;
        mockSyskit = typemoq.Mock.ofType2(syskit.Connection, [workspace, 'http://host:4242', client]);
        syskitConnection = mockSyskit.target;
    })

    afterEach(function() {
        helpers.clear();
    })

    function mockRESTResponse(method, url, data, statusCode) {
        clientMock.setup(x => x.call(method, url)).
            returns(() => Promise.resolve({ body: JSON.stringify(data), statusCode: statusCode }));
    }

    function mockRESTError(method, url, error) {
        clientMock.setup(x => x.call(method, url)).
            returns(() => Promise.reject(error));
    }

    describe("the call helpers", function() {
        let deployment : syskit.AvailableDeployment = {
            name: 'test',
            project_name: 'project',
            tasks: [
                { task_name: 'task', task_model_name: 'task::Model' }
            ],
            default_deployment_for: 'task::Model',
            default_logger: 'logger'
        }

        it("resolves with the data if the call is successful", async function() {
            mockRESTResponse('GET', "http://host:4242/api/syskit/deployments/available",
                { deployments: [deployment] }, 200);
            let result = await syskitConnection.availableDeployments();
            assert.deepStrictEqual([deployment], result);
        })

        it("rejects if the call returns an unexpected statusCode", async function() {
            mockRESTResponse('GET', "http://host:4242/api/syskit/deployments/available",
                { deployments: [deployment] }, 404);
            await helpers.assertThrowsAsync(syskitConnection.availableDeployments(), /.*/);
        })

        it("passes the response's error field if there is one", async function() {
            mockRESTResponse('GET', "http://host:4242/api/syskit/deployments/available",
                { error: 'error message' }, 404);
            await helpers.assertThrowsAsync(syskitConnection.availableDeployments(), /error message/);
        })

        it("passes the response if it has no error field", async function() {
            mockRESTResponse('GET', "http://host:4242/api/syskit/deployments/available",
                'error message', 404);
            await helpers.assertThrowsAsync(syskitConnection.availableDeployments(), /error message/);
        })

        it("rejects with the network error if there is one", async function() {
            mockRESTError('GET', "http://host:4242/api/syskit/deployments/available",
                new Error("network error"));;
            await helpers.assertThrowsAsync(syskitConnection.availableDeployments(), /network error/);
        })
    })

    describe("attemptConnection", function() {
        it("resolves to true if the ping is successful", async function() {
            mockRESTResponse('GET', "http://host:4242/api/ping?value=42", 42, 200);
            assert(await syskitConnection.attemptConnection());
        })

        it("resolves to false if the ping returns a wrong status", async function() {
            mockRESTResponse('GET', "http://host:4242/api/ping?value=42", 42, 404);
            assert(!await syskitConnection.attemptConnection());
        })

        it("resolves to false if the ping fails", async function() {
            let errorP = mockRESTError('GET', "http://host:4242/api/ping?value=42",
                new Error("TEST"));
            assert(!await syskitConnection.attemptConnection());
        })
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
            let syskit_run = new Promise<void>((resolve, reject) => syskit_run_resolve = resolve);
            mockWorkspace.setup(x => x.syskitDefaultStart()).
                returns(() => syskit_run)
            mockSyskit.setup(x => x.attemptConnection()).
                returns(() => Promise.resolve(true));
            await syskitConnection.connect(tokenSource.token);
            syskit_run_resolve();
        })
        it("fails if cancellation is requested", async function () {
            mockRESTError("GET", 'http://host:4242/api/ping?value=42', new Error("some network error"));
            let p = syskitConnection.connect(tokenSource.token);
            tokenSource.cancel();
            await helpers.assertThrowsAsync(p, /Syskit connection interrupted/);
        })
    })
})