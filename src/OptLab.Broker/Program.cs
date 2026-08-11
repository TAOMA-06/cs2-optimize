using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using OptLab.Broker;
using OptLab.Broker.Actions;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddSingleton<AllowedActionRegistry>();
builder.Services.AddSingleton<IRestrictedAction, MachineSummaryAction>();
builder.Services.AddHostedService<NamedPipeBrokerWorker>();

await builder.Build().RunAsync();

