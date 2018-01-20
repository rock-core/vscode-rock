begin
    require 'orocos'
    require 'orocos/async'
    require 'orogen'
    require 'optparse'

    do_conf = nil
    do_start = false
    parser = OptionParser.new
    parser.on '--start', 'starts the task' do
        do_start = true
    end
    parser.on '--conf-dir=DIR', String, 'directory to load configuration from' do |conf_source|
        do_conf = conf_source
    end
    model, _ = parser.parse(ARGV)

    OroGen.log_level = :fatal
    Orocos.initialize
    Orocos.conf.load_dir(do_conf) if do_conf

    task = Orocos::Async.proxy model
    task.on_reachable do
        Orocos.conf.apply(task.to_async, ['default'], true)
        if do_start
            task.configure if task.state == :PRE_OPERATIONAL
            task.start
        end
        exit 0
    end

    deadline = Time.now + 3.0
    loop do
        Orocos::Async.step
        sleep 0.1
        if Time.now > deadline
            puts '[ERROR] Task not reachable within 3s'
            exit 1
        end
    end
rescue Interrupt
    exit 1
end
