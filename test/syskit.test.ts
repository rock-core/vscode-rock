'use strict'
import * as typemoq from 'typemoq';
import { Connection, AvailableDeployment } from '../src/syskit'
import * as autoproj from '../src/autoproj'
import * as helpers from './helpers'
import * as vscode from 'vscode';
import * as rest from 'node-rest-client';
import * as assert from 'assert';
import { EventEmitter } from 'events';

describe("SyskitConnection", function() {
    let s : helpers.TestSetup;
    let root : string;
    let mockSyskit : typemoq.IMock<Connection>;
    let syskit : Connection;
    let mockWorkspace : typemoq.IMock<autoproj.Workspace>;
    let workspace : autoproj.Workspace;
    let clientMock : typemoq.IMock<rest.Client>;
    let client : rest.Client;

    beforeEach(function () {
        s = new helpers.TestSetup();
        root = helpers.init();
        let { mock, ws } = s.createAndRegisterWorkspace('ws');
        mockWorkspace = mock;
        workspace = ws;
        clientMock = typemoq.Mock.ofType<rest.Client>();
        client = clientMock.object;
        mockSyskit = typemoq.Mock.ofType2(Connection, [workspace, 'host', 4242, client]);
        syskit = mockSyskit.target;
    })

    afterEach(function() {
        helpers.clear();
    })

    function mockRESTResponse(method, url, data, statusCode) {
        clientMock.setup(x => x[method](url, typemoq.It.isAny())).
            callback((url, handler) => {
                handler(data, { statusCode: statusCode });
            }).
            returns(() => new EventEmitter());
    }

    function mockRESTError(method, url, error) {
        let emitter = new EventEmitter();
        return new Promise((resolve, reject) => {
            clientMock.setup(x => x[method](url, typemoq.It.isAny())).
                callback(() => resolve()).
                returns(() => emitter);
        }).then(() => emitter.emit('error', error))
    }

    describe("the call helpers", function() {
        let deployment : AvailableDeployment = {
            name: 'test',
            project_name: 'project',
            tasks: [
                { task_name: 'task', task_model_name: 'task::Model' }
            ],
            default_deployment_for: 'task::Model',
            default_logger: 'logger'
        }

        it("resolves with the data if the call is successful", async function() {
            mockRESTResponse('get', "http://host:4242/api/syskit/deployments/available",
                { deployments: [deployment] }, 200);
            let result = await syskit.availableDeployments();
            assert.deepStrictEqual([deployment], result);
        })

        it("rejects if the call returns an unexpected statusCode", async function() {
            mockRESTResponse('get', "http://host:4242/api/syskit/deployments/available",
                { deployments: [deployment] }, 404);
            await helpers.assertThrowsAsync(syskit.availableDeployments(), /.*/);
        })

        it("passes the response's error field if there is one", async function() {
            mockRESTResponse('get', "http://host:4242/api/syskit/deployments/available",
                { error: 'error message' }, 404);
            await helpers.assertThrowsAsync(syskit.availableDeployments(), /error message/);
        })

        it("passes the response if it has no error field", async function() {
            mockRESTResponse('get', "http://host:4242/api/syskit/deployments/available",
                'error message', 404);
            await helpers.assertThrowsAsync(syskit.availableDeployments(), /error message/);
        })

        it("rejects with the network error if there is one", async function() {
            mockRESTError('get', "http://host:4242/api/syskit/deployments/available",
                new Error("network error"));;
            await helpers.assertThrowsAsync(syskit.availableDeployments(), /network error/);
        })
    })

    describe("attemptConnection", function() {
        it("resolves to true if the ping is successful", async function() {
            mockRESTResponse('get', "http://host:4242/api/ping?value=42", 42, 200);
            assert(await syskit.attemptConnection());
        })

        it("resolves to false if the ping returns a wrong status", async function() {
            mockRESTResponse('get', "http://host:4242/api/ping?value=42", 42, 404);
            assert(!await syskit.attemptConnection());
        })

        it("resolves to false if the ping fails", async function() {
            let errorP = mockRESTError('get', "http://host:4242/api/ping?value=42",
                new Error("TEST"));
            assert(!await syskit.attemptConnection());
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
            await syskit.connect(tokenSource.token);
            syskit_run_resolve();
        })
        it("fails if cancellation is requested", async function () {
            let p = syskit.connect(tokenSource.token);
            tokenSource.cancel();
            await helpers.assertThrowsAsync(p, /Syskit connection interrupted/);
        })
    })
})