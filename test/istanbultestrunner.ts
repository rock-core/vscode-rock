/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
"use strict";
import fs = require("fs");
import istanbul = require("istanbul");
import Mocha = require("mocha");
import paths = require("path");

import glob = require("glob");
import remapIstanbul = require("remap-istanbul");

// Linux: prevent a weird NPE when mocha on Linux requires the window size from the TTY
// Since we are not running in a tty environment, we just implementt he method statically
import tty = require("tty");
if (!((tty as any).getWindowSize)) {
    (tty as any).getWindowSize = () => [80, 75];
}

let mocha = new Mocha({
    ui: "bdd",
    useColors: true,
});

let testOptions: any;

function configure(mochaOpts, testOpts): void {
    mocha = new Mocha(mochaOpts);
    testOptions = testOpts;
}
exports.configure = configure;

function _mkDirIfExists(dir: string): void {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }
}

function _readCoverOptions(testsRoot: string): ITestRunnerOptions | undefined {
    const coverConfigPath = paths.join(testsRoot, testOptions.coverConfig);
    let coverConfig;
    if (fs.existsSync(coverConfigPath)) {
        const configContent = fs.readFileSync(coverConfigPath, "utf-8");
        coverConfig = JSON.parse(configContent);
    }
    return coverConfig;
}

function run(testsRoot, clb): any {
    // Enable source map support
    require("source-map-support").install();

    // Read configuration for the coverage file
    const coverOptions: ITestRunnerOptions | undefined = _readCoverOptions(testsRoot);
    if (coverOptions && coverOptions.enabled) {
        // Setup coverage pre-test, including post-test hook to report
        const coverageRunner = new CoverageRunner(coverOptions, testsRoot, clb);
        coverageRunner.setupCoverage();
    }

    // Glob test files
    glob("**/**.test.js", { cwd: testsRoot }, (error, files) => {
        if (error) {
            return clb(error);
        }
        try {
            // Fill into Mocha
            files.forEach((f) => {
                return mocha.addFile(paths.join(testsRoot, f));
            });
            // Run the tests
            let failureCount = 0;

            mocha.run()
                .on("fail", (test, err) => {
                failureCount++;
            })
            .on("end", () => {
                clb(undefined, failureCount);
            });
        } catch (error) {
            return clb(error);
        }
    });
}
exports.run = run;

interface ITestRunnerOptions {
    enabled?: boolean;
    relativeCoverageDir: string;
    relativeSourcePath: string;
    ignorePatterns: string[];
    verbose?: boolean;
}

class CoverageRunner {

    private coverageVar: string = "$$cov_" + new Date().getTime() + "$$";
    private transformer: any = undefined;
    private matchFn: any = undefined;
    private instrumenter: any = undefined;

    constructor(private options: ITestRunnerOptions, private testsRoot: string, private endRunCallback: any) {
        if (!options.relativeSourcePath) {
            return endRunCallback("Error - relativeSourcePath must be defined for code coverage to work");
        }

    }

    public setupCoverage(): void {
        // Set up Code Coverage, hooking require so that instrumented code is returned
        const self = this;
        self.instrumenter = new istanbul.Instrumenter({ coverageVariable: self.coverageVar });
        const sourceRoot = paths.join(self.testsRoot, self.options.relativeSourcePath);

        // Glob source files
        const srcFiles = glob.sync("**/**.js", {
            cwd: sourceRoot,
            ignore: self.options.ignorePatterns,
        });

        // Create a match function - taken from the run-with-cover.js in istanbul.
        const decache = require("decache");
        const fileMap = {};
        srcFiles.forEach((file) => {
            const fullPath = paths.join(sourceRoot, file);
            fileMap[fullPath] = true;

            // On Windows, extension is loaded pre-test hooks and this mean we lose
            // our chance to hook the Require call. In order to instrument the code
            // we have to decache the JS file so on next load it gets instrumented.
            // This doesn't impact tests, but is a concern if we had some integration
            // tests that relied on VSCode accessing our module since there could be
            // some shared global state that we lose.
            decache(fullPath);
        });

        self.matchFn = (file) => fileMap[file];
        self.matchFn.files = Object.keys(fileMap);

        // Hook up to the Require function so that when this is called, if any of our source files
        // are required, the instrumented version is pulled in instead. These instrumented versions
        // write to a global coverage variable with hit counts whenever they are accessed
        self.transformer = self.instrumenter.instrumentSync.bind(self.instrumenter);
        const hookOpts = { verbose: false, extensions: [".js"]};
        istanbul.hook.hookRequire(self.matchFn, self.transformer, hookOpts);

        // initialize the global variable to stop mocha from complaining about leaks
        global[self.coverageVar] = {};

        // Hook the process exit event to handle reporting
        // Only report coverage if the process is exiting successfully
        process.on("exit", (code) => {
            self.reportCoverage();
        });
    }

    /**
     * Writes a coverage report. Note that as this is called in the process exit callback,
     * all calls must be synchronous.
     *
     * @returns {void}
     *
     * @memberOf CoverageRunner
     */
    public reportCoverage(): void {
        const self = this;
        istanbul.hook.unhookRequire();
        let cov: any;
        if (typeof global[self.coverageVar] === "undefined" || Object.keys(global[self.coverageVar]).length === 0) {
            // tslint:disable-next-line:no-console
            console.error("No coverage information was collected, exit without writing coverage information");
            return;
        } else {
            cov = global[self.coverageVar];
        }

        // TODO consider putting this under a conditional flag
        // Files that are not touched by code ran by the test runner is manually instrumented, to
        // illustrate the missing coverage.
        self.matchFn.files.forEach((file) => {
            if (!cov[file]) {
                self.transformer(fs.readFileSync(file, "utf-8"), file);

                // When instrumenting the code, istanbul will give each FunctionDeclaration a value
                // of 1 in coverState.s, presumably to compensate for function hoisting. We need to reset this,
                // as the function was not hoisted, as it was never loaded.
                Object.keys(self.instrumenter.coverState.s).forEach((key) => {
                    self.instrumenter.coverState.s[key] = 0;
                });

                cov[file] = self.instrumenter.coverState;
            }
        });

        // TODO Allow config of reporting directory with
        const reportingDir = paths.join(self.testsRoot, self.options.relativeCoverageDir);
        const includePid = true;
        const pidExt = includePid ? ("-" + process.pid) : "";
        const coverageFile = paths.resolve(reportingDir, "coverage" + pidExt + ".json");

        // yes, do this again since some test runners could clean the dir initially created
        _mkDirIfExists(reportingDir);
        fs.writeFileSync(coverageFile, JSON.stringify(cov), "utf8");

        const remappedCollector: istanbul.Collector = remapIstanbul.remap(cov, {warn: (warning) => {
            // We expect some warnings as any JS file without a typescript mapping will cause this.
            // By default, we'll skip printing these to the console as it clutters it up
            if (self.options.verbose) {
                // tslint:disable-next-line:no-console
                console.warn(warning);
            }
        }});

        const reporter = new istanbul.Reporter(undefined, reportingDir);
        reporter.addAll(["lcov"]);
        reporter.write(remappedCollector, true, () => {
            // tslint:disable-next-line:no-console
            console.log(`reports written to ${reportingDir}`);
        });
    }
}
