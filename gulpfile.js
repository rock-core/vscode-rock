var gulp = require('gulp');
var path = require('path');
var runSequence = require('run-sequence');
var del = require('del');
var jeditor = require("gulp-json-editor");

gulp.task('clean', function(callback) {
});

gulp.task('out:clean', function(callback) {
    return del('out', callback);
});
