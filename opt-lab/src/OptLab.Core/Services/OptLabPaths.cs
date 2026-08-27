namespace OptLab.Core.Services;

public static class OptLabPaths
{
    public static string UserDataDirectory => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "OptLab");

    public static string RecoveryDirectory => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        "OptLab",
        "recovery");
}
