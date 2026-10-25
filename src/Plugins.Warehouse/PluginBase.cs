using Microsoft.Xrm.Sdk;
using System;

namespace Plugins.Warehouse
{
    public interface ILocalPluginContext
    {
        IPluginExecutionContext PluginExecutionContext { get; }
        IOrganizationServiceFactory OrgSvcFactory { get; }
        ITracingService TracingService { get; }
    }

    internal sealed class LocalPluginContext : ILocalPluginContext
    {
        public LocalPluginContext(
            IPluginExecutionContext pluginExecutionContext,
            IOrganizationServiceFactory orgSvcFactory,
            ITracingService tracingService)
        {
            PluginExecutionContext = pluginExecutionContext;
            OrgSvcFactory = orgSvcFactory;
            TracingService = tracingService;
        }

        public IPluginExecutionContext PluginExecutionContext { get; }
        public IOrganizationServiceFactory OrgSvcFactory { get; }
        public ITracingService TracingService { get; }
    }

    public abstract class PluginBase : IPlugin
    {
        protected PluginBase(Type pluginType)
        {
            if (pluginType == null)
            {
                throw new ArgumentNullException(nameof(pluginType));
            }
        }

        public void Execute(IServiceProvider serviceProvider)
        {
            if (serviceProvider == null)
            {
                throw new ArgumentNullException(nameof(serviceProvider));
            }

            var executionContext =
                (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            var orgSvcFactory =
                (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));
            var tracingService =
                (ITracingService)serviceProvider.GetService(typeof(ITracingService));

            ExecuteDataversePlugin(new LocalPluginContext(executionContext, orgSvcFactory, tracingService));
        }

        protected abstract void ExecuteDataversePlugin(ILocalPluginContext localPluginContext);
    }
}
